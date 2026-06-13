const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const Watchdog = require("./watchdog");
const fs = require("fs").promises;
const path = require("path");

const TARGET_PH = 5.8;
const CALMAG_PPM_PER_ML_L = 375.0;
const BASE_PPM_PER_ML_L = 136.4;
const SUBMERSIBLE_FLOW_ML_PER_SEC = 50.0;

const NUTRIENT_PROFILE_PATH = path.join(
  process.cwd(),
  "config",
  "nutrient_profile.json",
);
const SYSTEM_CONFIG_PATH = path.join(process.cwd(), "config", "system.json");
const HARDWARE_CONFIG_PATH = path.join(
  process.cwd(),
  "config",
  "hardware.json",
);

class RecipeEngine {
  constructor(mqttService) {
    this.mqtt = mqttService;
    this.isTicking = false;
    this.peristalticFlowMlPerSec = null;
    this.submersibleFlowMlPerSec = null;
  }

  // ---------- Pure helpers ----------
  _calculateDilutionMl(sysVol, livePPM, targetPPM, maxBatchMl) {
    if (targetPPM <= 0) return Math.min(sysVol * 1000, maxBatchMl);
    const dilution = sysVol * 1000 * (livePPM / targetPPM - 1);
    return Math.min(Math.max(0, dilution), maxBatchMl);
  }

  _isPpHErrorSignificant(livePH, deadband = 0.2) {
    return Math.abs(livePH - TARGET_PH) > deadband;
  }

  _calculatePHDoseMl(pHerror) {
    return Math.min(5.0, Math.max(1.0, Math.abs(pHerror) * 5.0));
  }

  async _loadTickConfigs(systemState) {
    const strainProfilePath =
      systemState.currentProfilePath ||
      path.join(process.cwd(), "src/recipes/default.json");
    const rawStrain = await fs.readFile(strainProfilePath, "utf8");
    const strainProfile = JSON.parse(rawStrain);

    const rawNutrient = await fs.readFile(NUTRIENT_PROFILE_PATH, "utf8");
    const nutrientConfig = JSON.parse(rawNutrient);

    const rawSystem = await fs
      .readFile(SYSTEM_CONFIG_PATH, "utf8")
      .catch(() => '{"mixing":{"maxMixingTankVolumeMl":5000}}');
    const systemConfig = JSON.parse(rawSystem);
    const maxBatchMl = systemConfig.mixing?.maxMixingTankVolumeMl || 5000;

    return { strainProfile, nutrientConfig, maxBatchMl };
  }

  async _handleEcExcess(livePPM, targetPPM, sysVol, maxBatchMl, potId = "A") {
    const dilutionMl = this._calculateDilutionMl(
      sysVol,
      livePPM,
      targetPPM,
      maxBatchMl,
    );
    if (dilutionMl <= 50) return false;
    console.log(`🚀 Dilution batch: ${dilutionMl.toFixed(0)}ml water`);
    const actualWater = await this.executePumpAndWait(
      "Water",
      "dose_water",
      dilutionMl,
      { potId },
    );
    if (actualWater > 0) {
      await this._deliverToPot(actualWater * 1.2, potId);
      console.log(`✅ Dilution complete`);
      return true;
    }
    return false;
  }

  async _handleEcDeficit(
    livePPM,
    targetPPM,
    stage,
    currentDay,
    sysVol,
    nutrientConfig,
    maxBatchMl,
    potId = "A",
  ) {
    const deficitPPM = targetPPM - livePPM;
    console.log(`📉 EC Deficit -${deficitPPM.toFixed(0)} PPM`);
    const rawDose = this.calculateDeficit(
      targetPPM,
      deficitPPM,
      stage,
      currentDay,
      sysVol,
    );
    const totalNeeded =
      rawDose.cal + rawDose.gro + rawDose.micro + rawDose.bloom + rawDose.fin;
    if (totalNeeded <= 1.0) {
      console.log("Deficit too small, skipping");
      return false;
    }

    const MAX_NUT_PER_TICK = 15.0;
    let nutrientScale = 1.0;
    let batchScale = 1.0;

    const highestNut = Math.max(
      rawDose.cal,
      rawDose.micro,
      rawDose.gro,
      rawDose.bloom,
      rawDose.fin,
    );
    if (highestNut > MAX_NUT_PER_TICK)
      nutrientScale = MAX_NUT_PER_TICK / highestNut;

    const desiredCarrier = nutrientConfig.carrierVolumeMl;
    const theoreticalNutVol =
      (rawDose.cal +
        rawDose.micro +
        rawDose.gro +
        rawDose.bloom +
        rawDose.fin) *
      nutrientScale;
    const theoreticalTotal = desiredCarrier + theoreticalNutVol;
    if (theoreticalTotal > maxBatchMl)
      batchScale = maxBatchMl / theoreticalTotal;

    const finalCarrier = desiredCarrier * batchScale;
    const finalNutScale = nutrientScale * batchScale;

    const dose = {
      cal: rawDose.cal * finalNutScale,
      micro: rawDose.micro * finalNutScale,
      gro: rawDose.gro * finalNutScale,
      bloom: rawDose.bloom * finalNutScale,
      fin: rawDose.fin * finalNutScale,
    };

    console.log(`🚀 Nutrient batch: carrier ${finalCarrier.toFixed(0)}ml`);
    await this.executePumpAndWait(
      nutrientConfig.carrierFluid,
      "dose_water",
      finalCarrier,
      { potId },
    );

    let totalInjected = 0;
    const pumpMap = {
      CalMag: { topic: "dose_calmag", amount: dose.cal },
      Micro: { topic: "dose_micro", amount: dose.micro },
      Gro: { topic: "dose_gro_fin_relay", amount: dose.gro },
      Bloom: { topic: "dose_bloom", amount: dose.bloom },
      Finisher: { topic: "dose_gro_fin_relay", amount: dose.fin },
    };
    for (const nut of nutrientConfig.mixingSequence) {
      const p = pumpMap[nut];
      if (p && p.amount > 0.5) {
        totalInjected += await this.executePumpAndWait(nut, p.topic, p.amount, {
          potId,
        });
      }
    }

    const totalVolume = finalCarrier + totalInjected;
    await this._deliverToPot(totalVolume * 1.2, potId);
    console.log(`✅ Nutrient batch complete`);
    return true;
  }

  async _handlePhCorrection(livePH, potId = "A") {
    const pHerror = livePH - TARGET_PH;
    if (!this._isPpHErrorSignificant(livePH)) return false;
    const type = pHerror > 0 ? "pH_Down" : "pH_Up";
    const topic = pHerror > 0 ? "dose_ph_down" : "dose_ph_up";
    const doseMl = this._calculatePHDoseMl(pHerror);
    console.log(
      `🚀 pH correction: ${type} ${doseMl.toFixed(1)}ml (error = ${pHerror.toFixed(2)})`,
    );

    if (!(await Watchdog.isSafeToDose(type, doseMl, potId))) {
      console.log(`⏭️ pH correction blocked by watchdog`);
      return false;
    }
    await this.executePumpAndWait("Water", "dose_water", 250.0, { potId });
    const actualAcid = await this.executePumpAndWait(type, topic, doseMl, {
      potId,
    });
    await this._deliverToPot((250 + actualAcid) * 1.2, potId);
    console.log(`✅ pH correction complete`);
    return true;
  }

  // ---------- Curve helpers (unchanged) ----------
  resolveCurve(param, progress) {
    if (!param) return 0;
    progress = Math.max(0, Math.min(1, progress));
    return (
      param.start +
      (param.end - param.start) * Math.pow(progress, param.curve || 1.0)
    );
  }

  resolveCurveInPhase(node, dayInPhase, maxDaysInPhase, isRipeningPpm = false) {
    if (!node) return 0;
    if (isRipeningPpm) {
      const daysRemaining = maxDaysInPhase - dayInPhase;
      if (daysRemaining < 2) return 0;
      return node.start;
    }
    const progress =
      maxDaysInPhase > 1 ? (dayInPhase - 1) / (maxDaysInPhase - 1) : 1;
    return (
      node.start +
      (node.end - node.start) * Math.pow(progress, node.curve || 1.0)
    );
  }

  getTargetsForDay(profile, currentDay) {
    const flipDay = (profile.flipWeek - 1) * 7;
    const stretchDays = profile.stretchWks * 7;
    const bulkDays = profile.bulkWks * 7;
    const ripenDays = profile.ripenWks * 7;

    let phase, dayInPhase, maxDaysInPhase;
    if (currentDay <= flipDay) {
      phase = "veg";
      dayInPhase = currentDay;
      maxDaysInPhase = flipDay;
    } else if (currentDay <= flipDay + stretchDays) {
      phase = "initiation";
      dayInPhase = currentDay - flipDay;
      maxDaysInPhase = stretchDays;
    } else if (currentDay <= flipDay + stretchDays + bulkDays) {
      phase = "bulking";
      dayInPhase = currentDay - (flipDay + stretchDays);
      maxDaysInPhase = bulkDays;
    } else {
      phase = "ripening";
      dayInPhase = Math.min(
        currentDay - (flipDay + stretchDays + bulkDays),
        ripenDays,
      );
      maxDaysInPhase = ripenDays;
    }

    const pNode = profile.phases[phase];
    const targetPPM = this.resolveCurveInPhase(
      pNode.basePpm,
      dayInPhase,
      maxDaysInPhase,
      phase === "ripening",
    );
    const stageMap = {
      veg: "VEGETATIVE",
      initiation: "INITIATION",
      bulking: "BULKING",
      ripening: "RIPENING",
    };
    return { phase: stageMap[phase], targetPPM };
  }

  getDynamicTarget(profile, currentDay, livePPFD) {
    const flipDay = (profile.flipWeek - 1) * 7;
    const stretchDays = profile.stretchWks * 7;
    const bulkDays = profile.bulkWks * 7;
    const ripenDays = profile.ripenWks * 7;

    let phase, dayInPhase, maxDaysInPhase;
    if (currentDay <= flipDay) {
      phase = "veg";
      dayInPhase = currentDay;
      maxDaysInPhase = flipDay;
    } else if (currentDay <= flipDay + stretchDays) {
      phase = "initiation";
      dayInPhase = currentDay - flipDay;
      maxDaysInPhase = stretchDays;
    } else if (currentDay <= flipDay + stretchDays + bulkDays) {
      phase = "bulking";
      dayInPhase = currentDay - (flipDay + stretchDays);
      maxDaysInPhase = bulkDays;
    } else {
      phase = "ripening";
      dayInPhase = Math.min(
        currentDay - (flipDay + stretchDays + bulkDays),
        ripenDays,
      );
      maxDaysInPhase = ripenDays;
    }

    const pNode = profile.phases[phase];
    const isRipening = phase === "ripening";
    const stageMap = {
      veg: "VEGETATIVE",
      initiation: "INITIATION",
      bulking: "BULKING",
      ripening: "RIPENING",
    };

    const floorPpm = this.resolveCurveInPhase(
      pNode.basePpm,
      dayInPhase,
      maxDaysInPhase,
      isRipening,
    );
    if (isRipening && floorPpm === 0)
      return { phase: stageMap[phase], targetPPM: 0 };

    const targetPpfd = this.resolveCurveInPhase(
      pNode.ppfd,
      dayInPhase,
      maxDaysInPhase,
      false,
    );
    const lightMult = this.resolveCurveInPhase(
      pNode.lightMult,
      dayInPhase,
      maxDaysInPhase,
      false,
    );
    const effectivePPFD = livePPFD == null ? targetPpfd : livePPFD;
    const excessLight = Math.max(0, effectivePPFD - targetPpfd);
    const maxBoost = 150;
    const dynamicTargetPpm =
      floorPpm + Math.min(maxBoost, excessLight * lightMult);
    return { phase: stageMap[phase], targetPPM: dynamicTargetPpm };
  }

  calculateDeficit(targetPPM, deficitPPM, stage, currentDay, sysVol) {
    if (targetPPM <= 0) return { cal: 0, gro: 0, micro: 0, bloom: 0, fin: 0 };

    const targetCalCap = stage.toUpperCase() === "VEGETATIVE" ? 150.0 : 250.0;
    const targetCalPpm = Math.min(targetPPM, targetCalCap);
    const targetBasePpm = Math.max(0, targetPPM - targetCalPpm);

    const ratioCal = targetCalPpm / targetPPM;
    const ratioBase = targetBasePpm / targetPPM;

    const deficitCalPpm = deficitPPM * ratioCal;
    const deficitBasePpm = deficitPPM * ratioBase;

    const calMl = (deficitCalPpm * sysVol) / CALMAG_PPM_PER_ML_L;
    const totalBaseMl = (deficitBasePpm * sysVol) / BASE_PPM_PER_ML_L;

    let gro = 0,
      micro = 0,
      bloom = 0,
      fin = 0;
    const s = stage.toUpperCase();

    if (s === "RIPENING") {
      fin = totalBaseMl;
    } else {
      let partsG = 1,
        partsM = 1,
        partsB = 1;
      if (currentDay <= 7) {
        partsG = 1;
        partsM = 1;
        partsB = 1;
      } else if (s === "VEGETATIVE") {
        partsG = 3;
        partsM = 2;
        partsB = 1;
      } else if (s === "INITIATION") {
        partsG = 1;
        partsM = 2;
        partsB = 2;
      } else if (s === "BULKING") {
        partsG = 1;
        partsM = 2;
        partsB = 3;
      }
      const totalParts = partsG + partsM + partsB;
      const mlPerPart = totalBaseMl / totalParts;
      gro = partsG * mlPerPart;
      micro = partsM * mlPerPart;
      bloom = partsB * mlPerPart;
    }
    return { cal: calMl, gro, micro, bloom, fin };
  }

  async _ensureHardwareConfig() {
    if (this.peristalticFlowMlPerSec !== null) return;
    try {
      const raw = await fs.readFile(HARDWARE_CONFIG_PATH, "utf8");
      const config = JSON.parse(raw);
      this.peristalticFlowMlPerSec = config.peristaltic_ml_per_sec;
      this.submersibleFlowMlPerSec = config.submersible_ml_per_sec;
    } catch (err) {
      console.warn("⚠️ Could not load hardware.json, using defaults");
      this.peristalticFlowMlPerSec = 2.0;
      this.submersibleFlowMlPerSec = 50.0;
    }
  }

  async _deliverToPot(volumeMl, targetPot = "A") {
    await this._ensureHardwareConfig();
    if (volumeMl <= 0.5) return;
    let remaining = volumeMl;
    while (remaining > 0.5) {
      await this.mqtt.waitForDevice("pump_node_1");
      const startTime = Date.now();
      try {
        this.mqtt.sendCommand(
          "deliver",
          remaining,
          targetPot,
          this.mqtt.nextSeq(),
        );
        await this.mqtt.waitForIdle();
        remaining = 0;
      } catch (err) {
        if (err.message === "OFFLINE_INTERRUPT") {
          const elapsed = Date.now() - startTime;
          const pumped = (elapsed / 1000) * this.submersibleFlowMlPerSec;
          remaining -= pumped;
          if (remaining > 0.5) {
            console.warn(
              `⚠️ Delivery interrupted. Remaining: ${remaining.toFixed(1)}ml. Waiting...`,
            );
          }
        } else {
          throw err;
        }
      }
    }
  }

  async _getActivePots() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const pots = await prisma.telemetryLog.findMany({
      where: { timestamp: { gte: oneHourAgo } },
      select: { potId: true },
      distinct: ["potId"],
    });
    if (pots.length === 0) return ["A"];
    return pots.map((p) => p.potId);
  }

  async executePumpAndWait(pumpName, actionStr, amountMl, options = {}) {
    const {
      maxRetries = 3,
      retryDelayMs = 500,
      waitForDeviceTimeoutMs = 5000,
      waitForBusyTimeoutMs = 10000,
      waitForCompleteExtraMs = 30000,
      potId = "A",
    } = options;

    await this._ensureHardwareConfig();
    if (amountMl <= 0.5) return 0;
    const isWater = pumpName.toLowerCase().includes("water");
    const safeMl = isWater ? amountMl : Math.min(15.0, amountMl);
    const flowRate = this.peristalticFlowMlPerSec;

    if (!(await Watchdog.isSafeToDose(pumpName, safeMl, potId))) return 0;

    console.log(
      `⏳ Dosing: ${pumpName} (${safeMl.toFixed(1)}ml) for pot ${potId}`,
    );

    let remainingMl = safeMl;
    let retries = 0;

    while (remainingMl > 0.5 && retries < maxRetries) {
      try {
        await this.mqtt.waitForDevice("pump_node_1", waitForDeviceTimeoutMs);
      } catch (err) {
        console.warn(`⚠️ Device unreachable: ${err.message}. Retrying...`);
        retries++;
        if (retryDelayMs > 0)
          await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }

      if (retryDelayMs > 0)
        await new Promise((r) => setTimeout(r, retryDelayMs));

      const seq = this.mqtt.nextSeq();
      let doseStartTime = null;

      try {
        this.mqtt.sendCommand(actionStr, remainingMl, "None", seq);
        await this.mqtt.waitForBusy(waitForBusyTimeoutMs);
        doseStartTime = Date.now();

        const result = await Promise.race([
          this.waitForDoseComplete(
            seq,
            2 * (remainingMl / flowRate) * 1000 + waitForCompleteExtraMs,
          ),
          this.mqtt.waitForIdle().then(() => ({ type: "idle" })),
        ]);

        if (result.type === "complete") {
          remainingMl -= result.volume;
          if (remainingMl <= 0.5) break;
          console.log(
            `📦 Pump reported ${result.volume}ml, remaining ${remainingMl.toFixed(1)}ml`,
          );
        } else {
          remainingMl = 0;
          break;
        }
      } catch (err) {
        if (err.message === "OFFLINE_INTERRUPT") {
          retries++;
          console.warn(
            `⚠️ Disconnect during dose. Retry ${retries}/${maxRetries}`,
          );

          let assumedPumped = 0;
          if (doseStartTime) {
            assumedPumped = ((Date.now() - doseStartTime) / 1000) * flowRate;
          }

          try {
            await this.mqtt.waitForDevice(
              "pump_node_1",
              waitForDeviceTimeoutMs,
            );
            console.log(
              `🔌 Hardware reconnected. Waiting for completion or resume of seq=${seq}...`,
            );

            const result = await Promise.race([
              this.waitForDoseComplete(seq, 60000),
              this.mqtt.waitForBusy(60000, seq).then(() => ({ type: "busy" })),
            ]);

            if (result.type === "complete") {
              remainingMl -= result.volume;
              console.log(
                `✅ Pump reported completion: ${result.volume}ml, remaining ${remainingMl.toFixed(1)}ml`,
              );
              if (remainingMl <= 0.5) break;
            } else if (result.type === "busy") {
              console.log(`✅ Hardware resumed dose seq=${seq}.`);
              const finalResult = await Promise.race([
                this.waitForDoseComplete(seq, 60000),
                this.mqtt.waitForIdle().then(() => ({ type: "idle" })),
              ]);
              if (finalResult.type === "complete") {
                remainingMl -= finalResult.volume;
                if (remainingMl <= 0.5) break;
              } else {
                remainingMl = 0;
                break;
              }
            }
          } catch (err) {
            console.warn(
              `⚠️ No completion or resume. Deducting assumed ${assumedPumped.toFixed(1)}ml`,
            );
            remainingMl -= assumedPumped;
            if (remainingMl < 0) remainingMl = 0;
          }
        } else {
          throw err;
        }
      }
    }

    if (remainingMl > 0.5 && retries >= maxRetries) {
      throw new Error(
        `Failed to dose ${pumpName} after ${maxRetries} retries, ${remainingMl.toFixed(1)}ml left`,
      );
    }

    await Watchdog.logSuccessfulDose(pumpName, safeMl, potId);
    return safeMl;
  }

  waitForDoseComplete(seq, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("DOSE_COMPLETE_TIMEOUT")),
        timeoutMs,
      );
      const handler = (message) => {
        if (message.seq === seq && message.status === "dose_complete") {
          clearTimeout(timeout);
          this.mqtt.removeListener("pump_message", handler);
          resolve({ type: "complete", volume: message.volume_ml });
        }
      };
      this.mqtt.on("pump_message", handler);
    });
  }

  // ---------- Main tick ----------
  async executeTick() {
    if (this.isTicking) return;
    this.isTicking = true;

    try {
      console.log(`\n--- 🧠 [RECIPE ENGINE] TICK ---`);
      const activePots = await this._getActivePots();
      console.log(`Active pots: ${activePots.join(", ")}`);

      const systemState = await prisma.systemState.findFirst();
      if (!systemState) throw new Error("SystemState missing");

      const { strainProfile, nutrientConfig, maxBatchMl } =
        await this._loadTickConfigs(systemState);

      const currentDay = systemState.currentDay || 1;
      const sysVol = systemState.sysVol || 18.0;
      const dynamicData = this.getDynamicTarget(
        strainProfile,
        currentDay,
        null,
      );
      const targetPPM = dynamicData.targetPPM;
      const stage = dynamicData.phase;

      for (const potId of activePots) {
        console.log(`\n🔹 Processing pot ${potId}`);
        const telemetry = await prisma.telemetryLog.findFirst({
          where: { potId },
          orderBy: { timestamp: "desc" },
        });
        if (!telemetry) {
          console.log(`⏳ No telemetry for pot ${potId}, skipping.`);
          continue;
        }

        const livePPM = telemetry.realEC * 0.5;
        const livePH = telemetry.realPH;

        console.log(
          `📊 Live (Pot ${potId}) | pH: ${livePH.toFixed(2)} | PPM: ${livePPM.toFixed(0)}`,
        );
        console.log(
          `🎯 Target | Day: ${currentDay} | Phase: ${stage} | PPM: ${targetPPM.toFixed(0)}`,
        );

        if (telemetry.isTankOverflowing) {
          console.error(
            `💥 CRITICAL: Tank overflow detected for pot ${potId}! Stopping all pumps.`,
          );
          await this.mqtt.sendCommand("stop", 0, "None", this.mqtt.nextSeq());
          return;
        }
        if (telemetry.isTankEmpty) {
          console.warn(
            `⚠️ Tank empty for pot ${potId} – skipping corrections.`,
          );
          continue;
        }

        const deadbandPPM = 20;
        if (livePPM > targetPPM + deadbandPPM) {
          if (
            await this._handleEcExcess(
              livePPM,
              targetPPM,
              sysVol,
              maxBatchMl,
              potId,
            )
          ) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
        } else if (livePPM < targetPPM - deadbandPPM) {
          if (
            await this._handleEcDeficit(
              livePPM,
              targetPPM,
              stage,
              currentDay,
              sysVol,
              nutrientConfig,
              maxBatchMl,
              potId,
            )
          ) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
        }

        await this._handlePhCorrection(livePH, potId);
        await new Promise((r) => setTimeout(r, 500));
      }
      console.log(`✅ All pots stable`);
    } catch (err) {
      console.error("❌ Recipe Engine Error:", err);
      this.mqtt.sendCommand("stop", 0, "None", this.mqtt.nextSeq());
    } finally {
      this.isTicking = false;
    }
  }
}

module.exports = RecipeEngine;
