const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const Watchdog = require("./watchdog");
const fs = require("fs").promises;
const path = require("path");

const TARGET_PH = 5.8;
const CALMAG_PPM_PER_ML_L = 375.0;
const BASE_PPM_PER_ML_L = 136.4;

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

  resolveCurve(param, progress) {
    if (!param) return 0;
    progress = Math.max(0, Math.min(1, progress));
    return (
      param.start +
      (param.end - param.start) * Math.pow(progress, param.curve || 1.0)
    );
  }

  getBiologicalStage(currentDay, profile) {
    const fDay = (profile.flipWeek - 1) * 7;
    const sEnd = fDay + profile.stretchWks * 7;
    const bEnd = sEnd + profile.bulkWks * 7;
    const rEnd = bEnd + profile.ripenWks * 7;

    if (currentDay <= fDay)
      return {
        stage: "VEGETATIVE",
        progress: currentDay / Math.max(1, fDay),
        data: profile.phases.veg,
      };
    if (currentDay <= sEnd)
      return {
        stage: "INITIATION",
        progress: (currentDay - fDay) / Math.max(1, profile.stretchWks * 7),
        data: profile.phases.initiation,
      };
    if (currentDay <= bEnd)
      return {
        stage: "BULKING",
        progress: (currentDay - sEnd) / Math.max(1, profile.bulkWks * 7),
        data: profile.phases.bulking,
      };
    if (currentDay < rEnd - 1)
      return {
        stage: "RIPENING",
        progress: (currentDay - bEnd) / Math.max(1, profile.ripenWks * 7),
        data: profile.phases.ripening,
      };
    return { stage: "FLUSH", progress: 1.0, data: null };
  }

  resolveCurve(node, dayInPhase, maxDaysInPhase, isRipeningPpm = false) {
    if (!node) return 0;

    // THE OVERRIDE: The 2-Day Ripening Flush
    if (isRipeningPpm) {
      const daysRemaining = maxDaysInPhase - dayInPhase;
      if (daysRemaining < 2) return 0;
      return node.start; // EC is strictly held until the flush
    }

    // THE HARD CUT: (day - 1) / (max - 1) ensures Day 1 evaluates to exactly 0.0
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
    const targetPPM = this.resolveCurve(
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

    return { phase: stageMap[phase], targetPPM: targetPPM };
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

    // 1. Get Floor PPM
    const floorPpm = this.resolveCurve(
      pNode.basePpm,
      dayInPhase,
      maxDaysInPhase,
      isRipening,
    );

    // 2. Enforce Ripening Flush Override (Ignore light if flushing)
    if (isRipening && floorPpm === 0) {
      return { phase: stageMap[phase], targetPPM: 0 };
    }

    // 3. Apply Heatmap Logic
    const targetPpfd = this.resolveCurve(
      pNode.ppfd,
      dayInPhase,
      maxDaysInPhase,
      false,
    );
    const lightMult = this.resolveCurve(
      pNode.lightMult,
      dayInPhase,
      maxDaysInPhase,
      false,
    );

    const effectivePPFD =
      livePPFD === null || livePPFD === undefined ? targetPpfd : livePPFD;

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

    const calMl = (deficitCalPpm * sysVol) / CALMAG_PPM_PER_ML_L; // Uses your 375.0 constant
    const totalBaseMl = (deficitBasePpm * sysVol) / BASE_PPM_PER_ML_L; // Uses your 136.4 constant

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
        partsG = 2;
        partsM = 2;
        partsB = 2; // <-- THE INITIATION TYPO IS FIXED HERE!
      } else if (s === "BULKING") {
        partsG = 1;
        partsM = 2;
        partsB = 3;
      }

      let totalParts = partsG + partsM + partsB;
      let mlPerPart = totalBaseMl / totalParts;
      gro = partsG * mlPerPart;
      micro = partsM * mlPerPart;
      bloom = partsB * mlPerPart;
    }

    return { cal: calMl, gro, micro, bloom, fin };
  }

  async executeTick() {
    if (this.isTicking) return;
    this.isTicking = true;

    try {
      console.log(`\n--- 🧠 [RECIPE ENGINE] TICK INITIATED ---`);

      // 1. Fetch live telemetry from the database
      const telemetry = await prisma.telemetryLog.findFirst({
        orderBy: { timestamp: "desc" },
      });

      if (!telemetry) {
        console.log("⏳ Waiting for fresh telemetry...");
        this.isTicking = false;
        return;
      }

      // 2. Fetch System State and Active Profile
      const systemState = await prisma.systemState.findFirst();
      const rawProfile = await fs.readFile(NUTRIENT_PROFILE_PATH, "utf8");
      const activeProfile = JSON.parse(rawProfile);

      const currentDay = systemState.currentDay || 1;
      const sysVol = systemState.systemVolumeLiters || 18.0;

      // ==========================================
      // 3. THE WIRING: Engage the Dynamic Heatmap
      // ==========================================
      const dynamicData = this.getDynamicTarget(
        activeProfile,
        currentDay,
        null,
      );

      const targetPPM = dynamicData.targetPPM;
      const stage = dynamicData.phase;

      // Convert Live EC (uS/cm) to 500-Scale PPM
      const liveEC = telemetry.realEC;
      const livePPM = liveEC * 0.5;
      const livePH = telemetry.realPH;

      console.log(
        `📊 Live | pH: ${livePH.toFixed(2)} | PPM: ${livePPM.toFixed(0)} | PPFD: ${livePPFD}`,
      );
      console.log(
        `🎯 Protocol | Day: ${currentDay} | Phase: ${stage} | Target: ${targetPPM.toFixed(0)} PPM`,
      );

      const deadbandPPM = 20; // Prevent micro-dosing

      // ==========================================
      // PHASE 1: EC EXCESS (Dilution Priority)
      // ==========================================
      if (livePPM > targetPPM + deadbandPPM) {
        const excessPPM = livePPM - targetPPM;
        console.log(
          `📈 EC Excess Detected (+${excessPPM.toFixed(0)} PPM) | Priority override: Diluting before pH.`,
        );

        // Calculate dilution water needed (Safe estimation: limit to 5L per tick)
        const dilutionRatio = livePPM / targetPPM - 1;
        const dilutionMl = Math.min(sysVol * 1000 * dilutionRatio, 5000);

        if (dilutionMl > 50) {
          console.log(`🚀 --- INITIATING DILUTION BATCH ---`);
          const actualWater = await this.executePumpAndWait(
            "Fresh_Water",
            "dose_water",
            dilutionMl,
          );

          if (actualWater > 0) {
            const blowoutVolume = actualWater * 1.2;
            console.log(
              `🌊 Delivering ${actualWater.toFixed(1)}ml pure water (Blowout ${blowoutVolume.toFixed(1)}ml)...`,
            );

            // Submersible Delivery Retry Loop
            let remainingDeliver = blowoutVolume;
            while (remainingDeliver > 0.5) {
              await this.mqtt.waitForDevice("pump_node_1");
              let startTime = Date.now();
              try {
                this.mqtt.sendCommand(
                  "deliver",
                  remainingDeliver,
                  "A",
                  this.mqtt.nextSeq(),
                );
                await this.mqtt.waitForIdle();
                remainingDeliver = 0;
              } catch (err) {
                if (err.message === "OFFLINE_INTERRUPT") {
                  let elapsedMs = Date.now() - startTime;
                  let pumpedMl = (elapsedMs / 1000) * 50.0;
                  remainingDeliver -= pumpedMl;
                  if (remainingDeliver > 0.5)
                    console.warn(
                      `⚠️ Delivery interrupted. Remaining: ${remainingDeliver.toFixed(1)}ml. Waiting...`,
                    );
                } else throw err;
              }
            }
            console.log(`✅ --- DILUTION SEQUENCE COMPLETE --- \n`);
            this.isTicking = false;
            return; // Exit and wait 5 minutes for EC to stabilize before checking pH!
          }
        }
      }

      // ==========================================
      // PHASE 2: EC DEFICIT (Nutrient Priority)
      // ==========================================
      else if (livePPM < targetPPM - deadbandPPM) {
        const deficitPPM = targetPPM - livePPM;
        console.log(`📉 EC Deficit Detected (-${deficitPPM.toFixed(0)} PPM)`);

        // Generate the exact fractional doses based on currentDay and Stage!
        const dose = this.calculateDeficit(
          targetPPM,
          deficitPPM,
          stage,
          currentDay,
          sysVol,
        );
        const totalNutrients =
          dose.cal + dose.gro + dose.micro + dose.bloom + dose.fin;

        if (totalNutrients > 1.0) {
          console.log(`🚀 --- INITIATING NUTRIENT BATCH ---`);
          let totalDosed = 0;

          if (dose.cal > 0.5)
            totalDosed += await this.executePumpAndWait(
              "CalMag",
              "dose_calmag",
              dose.cal,
            );
          if (dose.micro > 0.5)
            totalDosed += await this.executePumpAndWait(
              "Micro",
              "dose_micro",
              dose.micro,
            );
          if (dose.gro > 0.5)
            totalDosed += await this.executePumpAndWait(
              "Gro",
              "dose_gro",
              dose.gro,
            );
          if (dose.bloom > 0.5)
            totalDosed += await this.executePumpAndWait(
              "Bloom",
              "dose_bloom",
              dose.bloom,
            );
          if (dose.fin > 0.5)
            totalDosed += await this.executePumpAndWait(
              "Finisher",
              "dose_finisher",
              dose.fin,
            );

          // Flush the manifold lines with RO water
          const flushWater = Math.max(250.0, totalDosed * 2.0);
          const actualWater = await this.executePumpAndWait(
            "Fresh_Water",
            "dose_water",
            flushWater,
          );

          const blowoutVolume = totalDosed + actualWater * 1.2;
          console.log(
            `🌊 Delivering ${blowoutVolume.toFixed(1)}ml payload to Pot A...`,
          );

          // Submersible Delivery Retry Loop
          let remainingDeliver = blowoutVolume;
          while (remainingDeliver > 0.5) {
            await this.mqtt.waitForDevice("pump_node_1");
            let startTime = Date.now();
            try {
              this.mqtt.sendCommand(
                "deliver",
                remainingDeliver,
                "A",
                this.mqtt.nextSeq(),
              );
              await this.mqtt.waitForIdle();
              remainingDeliver = 0;
            } catch (err) {
              if (err.message === "OFFLINE_INTERRUPT") {
                let elapsedMs = Date.now() - startTime;
                let pumpedMl = (elapsedMs / 1000) * 50.0;
                remainingDeliver -= pumpedMl;
                if (remainingDeliver > 0.5)
                  console.warn(
                    `⚠️ Delivery interrupted. Remaining: ${remainingDeliver.toFixed(1)}ml. Waiting...`,
                  );
              } else throw err;
            }
          }
          console.log(`✅ --- NUTRIENT SEQUENCE COMPLETE --- \n`);
          this.isTicking = false;
          return;
        }
      }

      // ==========================================
      // PHASE 3: pH CORRECTION (Only runs if EC is stable)
      // ==========================================
      if (livePH > TARGET_PH + 0.2 || livePH < TARGET_PH - 0.2) {
        const type = livePH > TARGET_PH ? "pH_Down" : "pH_Up";
        const topic = livePH > TARGET_PH ? "dose_ph_down" : "dose_ph_up";
        console.log(`\n🚀 --- INITIATING ${type} CORRECTION ---`);

        if (await Watchdog.isSafeToDose(type, 2.0)) {
          const actualWater = await this.executePumpAndWait(
            "Fresh_Water",
            "dose_water",
            250.0,
          );
          const actualAcid = await this.executePumpAndWait(type, topic, 2.0);

          const blowoutVolume = (actualWater + actualAcid) * 1.2;
          console.log(
            `🌊 Delivering ${blowoutVolume.toFixed(1)}ml payload to Pot A...`,
          );

          // Submersible Delivery Retry Loop
          let remainingDeliver = blowoutVolume;
          while (remainingDeliver > 0.5) {
            await this.mqtt.waitForDevice("pump_node_1");
            let startTime = Date.now();
            try {
              this.mqtt.sendCommand(
                "deliver",
                remainingDeliver,
                "A",
                this.mqtt.nextSeq(),
              );
              await this.mqtt.waitForIdle();
              remainingDeliver = 0;
            } catch (err) {
              if (err.message === "OFFLINE_INTERRUPT") {
                let elapsedMs = Date.now() - startTime;
                let pumpedMl = (elapsedMs / 1000) * 50.0;
                remainingDeliver -= pumpedMl;
                if (remainingDeliver > 0.5)
                  console.warn(
                    `⚠️ Delivery interrupted. Remaining: ${remainingDeliver.toFixed(1)}ml. Waiting...`,
                  );
              } else throw err;
            }
          }
          console.log(`✅ pH Correction Complete.\n`);
        } else {
          console.log(`⏭️ pH Correction skipped by Watchdog.`);
        }
      }
    } catch (err) {
      console.error("❌ Recipe Engine Error:", err);
      // Hard stop to prevent flooding on logic collapse
      this.mqtt.sendCommand("stop", 0, "None", this.mqtt.nextSeq());
    } finally {
      this.isTicking = false;
    }
  }

  async executePumpAndWait(pumpName, actionStr, amountMl, batchId = null) {
    if (amountMl <= 0.5) return 0;
    const isWater = pumpName.toLowerCase().includes("water");
    const safeMl = isWater ? amountMl : Math.min(15.0, amountMl);
    const flowRate = 20.0; // from config

    if (!(await Watchdog.isSafeToDose(pumpName, safeMl))) return 0;

    console.log(`⏳ Locking Manifold: ${pumpName} (${safeMl.toFixed(1)}ml)...`);

    let remainingMl = safeMl;
    let retries = 0;
    const MAX_RETRIES = 3;

    while (remainingMl > 0.5 && retries < MAX_RETRIES) {
      await this.mqtt.waitForDevice("pump_node_1");
      await new Promise((resolve) => setTimeout(resolve, 500));

      const seq = this.mqtt.nextSeq();
      let doseStartTime = null;
      let doseCompleted = false;

      try {
        this.mqtt.sendCommand(actionStr, remainingMl, "None", seq);
        await this.mqtt.waitForBusy(10000);
        doseStartTime = Date.now(); // <-- Record EXACT start time

        const result = await Promise.race([
          this.waitForDoseComplete(
            seq,
            2 * (remainingMl / flowRate) * 1000 + 10000,
          ),
          this.mqtt.waitForIdle().then(() => ({ type: "idle" })),
        ]);

        if (result.type === "complete") {
          remainingMl -= result.volume;
          if (remainingMl <= 0.5) {
            doseCompleted = true;
            break;
          }
          console.log(
            `📦 Pump reported ${result.volume}ml dosed, remaining ${remainingMl.toFixed(1)}ml`,
          );
        } else {
          remainingMl = 0;
          doseCompleted = true;
          break;
        }
      } catch (err) {
        if (err.message === "OFFLINE_INTERRUPT") {
          retries++;
          console.warn(
            `⚠️ Disconnect during dose. Server will await hardware resume. Retry ${retries}/${MAX_RETRIES}`,
          );

          // --- THE OVERFLOW SHIELD ---
          // Calculate max possible volume pumped before the crash
          let assumedPumped = 0;
          if (doseStartTime !== null) {
            let elapsed = Date.now() - doseStartTime;
            assumedPumped = (elapsed / 1000) * flowRate;
          }

          try {
            await this.mqtt.waitForDevice("pump_node_1");
            console.log(
              `🔌 Hardware reconnected. Waiting for resume announcement for seq=${seq}...`,
            );
            await this.mqtt.waitForBusy(15000, seq);
            console.log(
              `✅ Hardware successfully resumed dose seq=${seq}. Re-attaching listener.`,
            );

            const result = await Promise.race([
              this.waitForDoseComplete(
                seq,
                2 * (remainingMl / flowRate) * 1000 + 10000,
              ),
              this.mqtt.waitForIdle().then(() => ({ type: "idle" })),
            ]);

            if (result.type === "complete") {
              remainingMl -= result.volume;
              if (remainingMl <= 0.5) {
                doseCompleted = true;
                break;
              }
            } else {
              remainingMl = 0;
              doseCompleted = true;
              break;
            }
            continue;
          } catch (resumeErr) {
            console.warn(
              `⚠️ Hardware did not auto-resume (power crash). Deducting assumed volume: ${assumedPumped.toFixed(1)}ml`,
            );
            remainingMl -= assumedPumped;
            if (remainingMl < 0) remainingMl = 0;
            continue;
          }
        } else {
          throw err;
        }
      }
    }

    if (remainingMl > 0.5 && retries >= MAX_RETRIES) {
      throw new Error(
        `Failed to dose ${pumpName} after ${MAX_RETRIES} retries, ${remainingMl.toFixed(1)}ml remaining`,
      );
    }

    await Watchdog.logSuccessfulDose(pumpName, safeMl);
    return safeMl;
  }

  // Helper: wait for a dose_complete message with matching seq
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

  async evaluateAndDose(
    livePH,
    livePPM,
    targetPPM,
    stage,
    currentDay,
    sysVol,
    forceWaterTopOff,
  ) {
    const deadbandPPM = Math.max(15, Math.min(50, targetPPM * 0.1));
    const sysConfig = JSON.parse(
      await fs
        .readFile(SYSTEM_CONFIG_PATH, "utf8")
        .catch(() => '{"mixing":{"maxMixingTankVolumeMl":5000}}'),
    );
    const MAX_BATCH_ML = sysConfig.mixing?.maxMixingTankVolumeMl || 5000.0;

    // ==========================================
    // 1. EC PRIORITY: DEFICIT (Nutrients Needed)
    // ==========================================
    if (livePPM < targetPPM - deadbandPPM || forceWaterTopOff) {
      const deficitPPM = forceWaterTopOff ? 0 : targetPPM - livePPM;
      if (!forceWaterTopOff)
        console.log(`📉 EC Deficit Detected (-${deficitPPM.toFixed(0)} PPM)`);

      const rawDose = this.calculateDeficit(
        targetPPM,
        deficitPPM,
        stage,
        currentDay,
        sysVol,
      );
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

      const highestNutrient = Math.max(
        rawDose.cal,
        rawDose.micro,
        rawDose.gro,
        rawDose.bloom,
        rawDose.fin,
      );
      if (highestNutrient > MAX_NUT_PER_TICK) {
        nutrientScale = MAX_NUT_PER_TICK / highestNutrient;
      }

      const desiredCarrier = forceWaterTopOff
        ? MAX_BATCH_ML - 100
        : nutConfig.carrierVolumeMl;
      const theoreticalNutrientVol =
        (rawDose.cal +
          rawDose.micro +
          rawDose.gro +
          rawDose.bloom +
          rawDose.fin) *
        nutrientScale;
      const theoreticalTotalBatch = desiredCarrier + theoreticalNutrientVol;

      if (theoreticalTotalBatch > MAX_BATCH_ML) {
        batchScale = MAX_BATCH_ML / theoreticalTotalBatch;
      }

      const finalCarrierMl = desiredCarrier * batchScale;
      const finalNutScale = nutrientScale * batchScale;

      rawDose.cal *= finalNutScale;
      rawDose.micro *= finalNutScale;
      rawDose.gro *= finalNutScale;
      rawDose.bloom *= finalNutScale;
      rawDose.fin *= finalNutScale;

      console.log(`\n🚀 --- INITIATING NUTRIENT BATCH ---`);
      await this.executePumpAndWait(
        nutConfig.carrierFluid,
        "dose_water",
        finalCarrierMl,
      );

      let totalInjected = 0;
      const doseMap = {
        CalMag: { topic: "dose_calmag", amount: rawDose.cal },
        Micro: { topic: "dose_micro", amount: rawDose.micro },
        Gro: { topic: "dose_gro_fin_relay", amount: rawDose.gro },
        Bloom: { topic: "dose_bloom", amount: rawDose.bloom },
        Finisher: { topic: "dose_gro_fin_relay", amount: rawDose.fin },
      };

      for (const nut of nutConfig.mixingSequence) {
        if (doseMap[nut] && doseMap[nut].amount > 0.5) {
          totalInjected += await this.executePumpAndWait(
            nut,
            doseMap[nut].topic,
            doseMap[nut].amount,
          );
        }
      }

      const totalVolume = finalCarrierMl + totalInjected;
      const blowoutVolume = totalVolume * 1.2;

      console.log(
        `🌊 Delivering ${totalVolume.toFixed(1)}ml (Blowout ${blowoutVolume.toFixed(1)}ml) to Pot A...`,
      );

      let remainingDeliver = blowoutVolume;
      while (remainingDeliver > 0.5) {
        await this.mqtt.waitForDevice("pump_node_1");
        let startTime = Date.now();
        try {
          this.mqtt.sendCommand("deliver", remainingDeliver, "A");
          await this.mqtt.waitForIdle();
          remainingDeliver = 0;
        } catch (err) {
          if (err.message === "OFFLINE_INTERRUPT") {
            let elapsedMs = Date.now() - startTime;
            let pumpedMl = (elapsedMs / 1000) * 50.0; // Submersible flow rate
            remainingDeliver -= pumpedMl;
            if (remainingDeliver > 0.5)
              console.warn(
                `⚠️ Delivery interrupted. Remaining: ${remainingDeliver.toFixed(1)}ml. Waiting to resume...`,
              );
          } else throw err;
        }
      }
      console.log(`✅ --- BATCH SEQUENCE COMPLETE --- \n`);
      return;
    }

    // ==========================================
    // 2. EC PRIORITY: EXCESS (Dilution Required)
    // ==========================================
    else if (livePPM > targetPPM + deadbandPPM && !forceWaterTopOff) {
      const excessPPM = livePPM - targetPPM;
      console.log(
        `📈 EC Excess Detected (+${excessPPM.toFixed(0)} PPM) | Priority override: Diluting before pH.`,
      );

      // V_add = V_sys * ((PPM_live / PPM_target) - 1)
      let dilutionMl = MAX_BATCH_ML;
      if (targetPPM > 0) {
        dilutionMl = sysVol * 1000 * (livePPM / targetPPM - 1);
      }
      if (dilutionMl > MAX_BATCH_ML) dilutionMl = MAX_BATCH_ML;

      if (dilutionMl > 100) {
        console.log(`\n🚀 --- INITIATING DILUTION BATCH ---`);

        // Create batch record
        const batch = await prisma.batchState.create({
          data: {
            active: true,
            batchType: "DILUTION",
            totalWaterMl: dilutionMl,
            confirmedWaterMl: 0,
            startedAt: new Date(),
          },
        });

        try {
          await this.executePumpAndWait("Water", "dose_water", dilutionMl);
          await prisma.batchState.update({
            where: { id: batch.id },
            data: { confirmedWaterMl: dilutionMl },
          });

          const blowoutVolume = dilutionMl * 1.2;
          console.log(
            `🌊 Delivering ${dilutionMl.toFixed(1)}ml pure water (Blowout ${blowoutVolume.toFixed(1)}ml) to Pot A...`,
          );

          let remainingDeliver = blowoutVolume;
          while (remainingDeliver > 0.5) {
            await this.mqtt.waitForDevice("pump_node_1");
            let startTime = Date.now();
            try {
              this.mqtt.sendCommand("deliver", remainingDeliver, "A");
              await this.mqtt.waitForIdle();
              remainingDeliver = 0;
            } catch (err) {
              if (err.message === "OFFLINE_INTERRUPT") {
                let elapsedMs = Date.now() - startTime;
                let pumpedMl = (elapsedMs / 1000) * 50.0; // Submersible flow rate
                remainingDeliver -= pumpedMl;
                if (remainingDeliver > 0.5)
                  console.warn(
                    `⚠️ Delivery interrupted. Remaining: ${remainingDeliver.toFixed(1)}ml. Waiting to resume...`,
                  );
              } else throw err;
            }
          }

          await prisma.batchState.update({
            where: { id: batch.id },
            data: { active: false },
          });
          console.log(`✅ --- DILUTION SEQUENCE COMPLETE --- \n`);
          return;
        } catch (err) {
          await prisma.batchState.update({
            where: { id: batch.id },
            data: { active: false },
          });
          throw err;
        }
      }
    }

    // ==========================================
    // 3. pH CORRECTION (Only if EC is stable)
    // ==========================================
    if (livePH > TARGET_PH + 0.2 || livePH < TARGET_PH - 0.2) {
      const type = livePH > TARGET_PH ? "pH_Down" : "pH_Up";
      const topic = livePH > TARGET_PH ? "dose_ph_down" : "dose_ph_up";
      console.log(`\n🚀 --- INITIATING ${type} CORRECTION ---`);

      if (await Watchdog.isSafeToDose(type, 2.0)) {
        await this.executePumpAndWait("Water", "dose_water", 250.0);
        const actualAcid = await this.executePumpAndWait(type, topic, 2.0);

        const totalVolume = 250.0 + actualAcid;
        const blowoutVolume = totalVolume * 1.2;

        // --- THE FIX: Add the Delivery Retry Loop ---
        let remainingDeliver = blowoutVolume;
        while (remainingDeliver > 0.5) {
          await this.mqtt.waitForDevice("pump_node_1");
          let startTime = Date.now();
          try {
            this.mqtt.sendCommand("deliver", remainingDeliver, "A");
            await this.mqtt.waitForIdle();
            remainingDeliver = 0;
          } catch (err) {
            if (err.message === "OFFLINE_INTERRUPT") {
              let elapsedMs = Date.now() - startTime;
              let pumpedMl = (elapsedMs / 1000) * 50.0;
              remainingDeliver -= pumpedMl;
              if (remainingDeliver > 0.5)
                console.warn(
                  `⚠️ Delivery interrupted. Remaining: ${remainingDeliver.toFixed(1)}ml. Waiting to resume...`,
                );
            } else throw err;
          }
        }
        console.log(`✅ pH Correction Complete.`);
      } else {
        console.warn(`🚫 Aborting pH Correction: Watchdog blocked ${type}.`);
      }
    } else {
      console.log(`✅ System Stable.`);
    }
  }
}

module.exports = RecipeEngine;
