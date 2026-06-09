const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const Watchdog = require("./watchdog");
const fs = require("fs").promises;
const path = require("path");

const TARGET_PH = 5.8;
const CALMAG_PPM_PER_ML_L = 375.0;
const BASE_PPM_PER_ML_L = 136.4;
const SUBMERSIBLE_FLOW_ML_PER_SEC = 50.0; // matches firmware

const NUTRIENT_PROFILE_PATH = path.join(
  process.cwd(),
  "config",
  "nutrient_profile.json",
);
const SYSTEM_CONFIG_PATH = path.join(process.cwd(), "config", "system.json");

class RecipeEngine {
  constructor(mqttService) {
    this.mqtt = mqttService;
    this.isTicking = false;
  }

  // ---------- Pure helpers ----------
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
    const dynamicTargetPpm = floorPpm + excessLight * lightMult;

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

  // ---------- Core delivery helper (with retry & overflow shield) ----------
  async _deliverToPot(volumeMl, targetPot = "A") {
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
          const pumped = (elapsed / 1000) * SUBMERSIBLE_FLOW_ML_PER_SEC;
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

  // ---------- Single pump dose (with watchdog, retries, and resume logic) ----------
  async executePumpAndWait(pumpName, actionStr, amountMl) {
    if (amountMl <= 0.5) return 0;
    const isWater = pumpName.toLowerCase().includes("water");
    const safeMl = isWater ? amountMl : Math.min(15.0, amountMl);
    const flowRate = 200.0; // aligned with firmware (mL/s)

    if (!(await Watchdog.isSafeToDose(pumpName, safeMl))) return 0;

    console.log(`⏳ Dosing: ${pumpName} (${safeMl.toFixed(1)}ml)`);

    let remainingMl = safeMl;
    let retries = 0;
    const MAX_RETRIES = 3;

    while (remainingMl > 0.5 && retries < MAX_RETRIES) {
      await this.mqtt.waitForDevice("pump_node_1");
      await new Promise((resolve) => setTimeout(resolve, 500));

      const seq = this.mqtt.nextSeq();
      let doseStartTime = null;

      try {
        this.mqtt.sendCommand(actionStr, remainingMl, "None", seq);
        await this.mqtt.waitForBusy(10000);
        doseStartTime = Date.now();

        const result = await Promise.race([
          this.waitForDoseComplete(
            seq,
            2 * (remainingMl / flowRate) * 1000 + 10000,
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
            `⚠️ Disconnect during dose. Retry ${retries}/${MAX_RETRIES}`,
          );

          let assumedPumped = 0;
          if (doseStartTime) {
            assumedPumped = ((Date.now() - doseStartTime) / 1000) * flowRate;
          }

          try {
            await this.mqtt.waitForDevice("pump_node_1");
            console.log(
              `🔌 Hardware reconnected. Waiting for resume of seq=${seq}...`,
            );
            await this.mqtt.waitForBusy(15000, seq);
            console.log(`✅ Hardware resumed dose seq=${seq}.`);

            const result = await Promise.race([
              this.waitForDoseComplete(
                seq,
                2 * (remainingMl / flowRate) * 1000 + 10000,
              ),
              this.mqtt.waitForIdle().then(() => ({ type: "idle" })),
            ]);

            if (result.type === "complete") {
              remainingMl -= result.volume;
              if (remainingMl <= 0.5) break;
            } else {
              remainingMl = 0;
              break;
            }
          } catch (resumeErr) {
            console.warn(
              `⚠️ No auto‑resume. Deducting assumed ${assumedPumped.toFixed(1)}ml`,
            );
            remainingMl -= assumedPumped;
            if (remainingMl < 0) remainingMl = 0;
          }
        } else {
          throw err;
        }
      }
    }

    if (remainingMl > 0.5 && retries >= MAX_RETRIES) {
      throw new Error(
        `Failed to dose ${pumpName} after ${MAX_RETRIES} retries, ${remainingMl.toFixed(1)}ml left`,
      );
    }

    await Watchdog.logSuccessfulDose(pumpName, safeMl);
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

  // ---------- Main tick (refactored, uses batch scaling from nutrient_profile) ----------
  async executeTick() {
    if (this.isTicking) return;
    this.isTicking = true;

    try {
      console.log(`\n--- 🧠 [RECIPE ENGINE] TICK ---`);

      const telemetry = await prisma.telemetryLog.findFirst({
        orderBy: { timestamp: "desc" },
      });
      if (!telemetry) {
        console.log("⏳ No telemetry yet.");
        this.isTicking = false;
        return;
      }

      const systemState = await prisma.systemState.findFirst();
      if (!systemState) throw new Error("SystemState missing");

      const rawProfile = await fs.readFile(NUTRIENT_PROFILE_PATH, "utf8");
      const activeProfile = JSON.parse(rawProfile);
      const sysConfig = JSON.parse(
        await fs
          .readFile(SYSTEM_CONFIG_PATH, "utf8")
          .catch(() => '{"mixing":{"maxMixingTankVolumeMl":5000}}'),
      );
      const MAX_BATCH_ML = sysConfig.mixing?.maxMixingTankVolumeMl || 5000;

      const currentDay = systemState.currentDay || 1;
      const sysVol = systemState.sysVol || 18.0; // unified field

      const dynamicData = this.getDynamicTarget(
        activeProfile,
        currentDay,
        null,
      );
      const targetPPM = dynamicData.targetPPM;
      const stage = dynamicData.phase;

      const liveEC = telemetry.realEC;
      const livePPM = liveEC * 0.5;
      const livePH = telemetry.realPH;

      console.log(
        `📊 Live | pH: ${livePH.toFixed(2)} | PPM: ${livePPM.toFixed(0)}`,
      );
      console.log(
        `🎯 Target | Day: ${currentDay} | Phase: ${stage} | PPM: ${targetPPM.toFixed(0)}`,
      );

      const deadbandPPM = 20;

      // ---------- 1. EC Excess (Dilution) ----------
      if (livePPM > targetPPM + deadbandPPM) {
        const excessPPM = livePPM - targetPPM;
        console.log(`📈 EC Excess +${excessPPM.toFixed(0)} PPM – diluting`);
        const dilutionMl = Math.min(
          sysVol * 1000 * (livePPM / targetPPM - 1),
          MAX_BATCH_ML,
        );
        if (dilutionMl > 50) {
          console.log(`🚀 Dilution batch: ${dilutionMl.toFixed(0)}ml water`);
          const actualWater = await this.executePumpAndWait(
            "Water",
            "dose_water",
            dilutionMl,
          );
          if (actualWater > 0) {
            await this._deliverToPot(actualWater * 1.2);
            console.log(`✅ Dilution complete`);
            this.isTicking = false;
            return;
          }
        }
      }
      // ---------- 2. EC Deficit (Nutrients) ----------
      else if (livePPM < targetPPM - deadbandPPM) {
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
          rawDose.cal +
          rawDose.gro +
          rawDose.micro +
          rawDose.bloom +
          rawDose.fin;
        if (totalNeeded <= 1.0) {
          console.log("Deficit too small, skipping");
          this.isTicking = false;
          return;
        }

        // Load nutrient profile for batch scaling
        const nutConfig = JSON.parse(
          await fs
            .readFile(NUTRIENT_PROFILE_PATH, "utf8")
            .catch(
              () =>
                '{"carrierFluid":"Water","carrierVolumeMl":500,"mixingSequence":[]}',
            ),
        );

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

        const desiredCarrier = nutConfig.carrierVolumeMl;
        const theoreticalNutVol =
          (rawDose.cal +
            rawDose.micro +
            rawDose.gro +
            rawDose.bloom +
            rawDose.fin) *
          nutrientScale;
        const theoreticalTotal = desiredCarrier + theoreticalNutVol;
        if (theoreticalTotal > MAX_BATCH_ML)
          batchScale = MAX_BATCH_ML / theoreticalTotal;

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
          nutConfig.carrierFluid,
          "dose_water",
          finalCarrier,
        );

        let totalInjected = 0;
        const pumpMap = {
          CalMag: { topic: "dose_calmag", amount: dose.cal },
          Micro: { topic: "dose_micro", amount: dose.micro },
          Gro: { topic: "dose_gro_fin_relay", amount: dose.gro },
          Bloom: { topic: "dose_bloom", amount: dose.bloom },
          Finisher: { topic: "dose_gro_fin_relay", amount: dose.fin },
        };
        for (const nut of nutConfig.mixingSequence) {
          const p = pumpMap[nut];
          if (p && p.amount > 0.5) {
            totalInjected += await this.executePumpAndWait(
              nut,
              p.topic,
              p.amount,
            );
          }
        }

        const totalVolume = finalCarrier + totalInjected;
        await this._deliverToPot(totalVolume * 1.2);
        console.log(`✅ Nutrient batch complete`);
        this.isTicking = false;
        return;
      }

      // ---------- 3. pH Correction (proportional) ----------
      const pHerror = livePH - TARGET_PH;
      if (Math.abs(pHerror) > 0.2) {
        const type = pHerror > 0 ? "pH_Down" : "pH_Up";
        const topic = pHerror > 0 ? "dose_ph_down" : "dose_ph_up";
        // Proportional dose: 0.5 ml per 0.1 pH error, min 1 ml, max 5 ml
        let doseMl = Math.min(5.0, Math.max(1.0, Math.abs(pHerror) * 5.0));
        console.log(
          `🚀 pH correction: ${type} ${doseMl.toFixed(1)}ml (error = ${pHerror.toFixed(2)})`,
        );

        if (await Watchdog.isSafeToDose(type, doseMl)) {
          await this.executePumpAndWait("Water", "dose_water", 250.0);
          const actualAcid = await this.executePumpAndWait(type, topic, doseMl);
          const totalVol = 250 + actualAcid;
          await this._deliverToPot(totalVol * 1.2);
          console.log(`✅ pH correction complete`);
        } else {
          console.log(`⏭️ pH correction blocked by watchdog`);
        }
      } else {
        console.log(`✅ System stable`);
      }
    } catch (err) {
      console.error("❌ Recipe Engine Error:", err);
      this.mqtt.sendCommand("stop", 0, "None", this.mqtt.nextSeq());
    } finally {
      this.isTicking = false;
    }
  }
}

module.exports = RecipeEngine;
