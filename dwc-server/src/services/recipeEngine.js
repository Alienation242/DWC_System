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

  calculateDeficitMath(targetPPM, deficitPPM, stage, exactDays, sysVol) {
    if (stage === "FLUSH")
      return { cal: 0, gro: 0, micro: 0, bloom: 0, fin: 0 };

    const targetCalPpm = stage === "VEGETATIVE" ? 150 : 250;
    const idealCalMagPpm = Math.min(targetPPM, targetCalPpm);
    const idealBasePpm = Math.max(0, targetPPM - idealCalMagPpm);

    const ppmNeededCal = deficitPPM * (idealCalMagPpm / targetPPM);
    const ppmNeededBase = deficitPPM * (idealBasePpm / targetPPM);

    const calMag_ml = (ppmNeededCal / CALMAG_PPM_PER_ML_L) * sysVol;
    const totalBase_ml = (ppmNeededBase / BASE_PPM_PER_ML_L) * sysVol;

    let gro = 0,
      micro = 0,
      bloom = 0,
      fin = 0;

    if (stage === "RIPENING") {
      fin = totalBase_ml;
    } else {
      let pG = 1,
        pM = 1,
        pB = 1;
      if (exactDays <= 7) {
        pG = 1;
        pM = 1;
        pB = 1;
      } else if (stage === "VEGETATIVE") {
        pG = 3;
        pM = 2;
        pB = 1;
      } else if (stage === "INITIATION") {
        pG = 1;
        pM = 2;
        pB = 2;
      } else if (stage === "BULKING") {
        pG = 1;
        pM = 2;
        pB = 3;
      }

      const totalParts = pG + pM + pB;
      const mlPerPart = totalBase_ml / totalParts;
      gro = pG * mlPerPart;
      micro = pM * mlPerPart;
      bloom = pB * mlPerPart;
    }
    return { cal: calMag_ml, gro, micro, bloom, fin };
  }

  async executeTick() {
    if (this.isTicking) {
      console.warn(
        "⚠️ Engine is currently active. Ignoring overlapping tick request.",
      );
      return;
    }

    if (this.mqtt.deviceRegistry["pump_node_1"] === "offline") {
      console.error("🛑 CRITICAL: Pump Manifold is OFFLINE. Aborting tick.");
      return;
    }
    if (this.mqtt.deviceRegistry["sensor_node_1"] === "offline") {
      console.error(
        "🛑 CRITICAL: Sensor Node is OFFLINE. Aborting tick to prevent blind dosing.",
      );
      return;
    }

    this.isTicking = true;
    console.log("\n--- 🧠 [RECIPE ENGINE] TICK INITIATED ---");

    try {
      const state = await prisma.systemState.findUnique({ where: { id: 1 } });
      if (!state || state.automationMode === "MANUAL_OVERRIDE") return;

      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      const recentLogs = await prisma.telemetryLog.findMany({
        take: 5,
        where: { timestamp: { gte: twoMinutesAgo } },
        orderBy: { timestamp: "desc" },
      });

      if (recentLogs.length === 0)
        return console.log("⏳ Waiting for fresh telemetry...");

      const currentStatus = recentLogs[0];
      if (currentStatus.isTankOverflowing) {
        this.mqtt.sendCommand("stop");
        return console.error(
          "🛑 CRITICAL: Pot is overflowing! Aborting all pump operations.",
        );
      }

      const validLogs = recentLogs.filter((log) => !log.isTankEmpty);

      let livePH = 5.8;
      let livePPM = 0;

      if (validLogs.length > 0) {
        livePH = validLogs.reduce((s, l) => s + l.realPH, 0) / validLogs.length;
        livePPM =
          validLogs.reduce((s, l) => s + l.realEC, 0) / validLogs.length;
      } else if (!currentStatus.isTankEmpty) {
        return console.log("⏳ Waiting for stable wet telemetry...");
      }

      console.log(
        `📊 Live | pH: ${livePH.toFixed(2)} | PPM: ${Math.round(livePPM)}`,
      );

      const rawProfile = await fs.readFile(
        path.join(process.cwd(), state.currentProfilePath),
        "utf8",
      );
      const strainData = JSON.parse(rawProfile);
      const bio = this.getBiologicalStage(state.currentDay, strainData);

      let baseTarget = 0;
      if (bio.stage === "FLUSH") {
        console.log("💧 FLUSH STAGE: 0 PPM Target.");
        baseTarget = 0;
      } else {
        baseTarget = this.resolveCurve(bio.data.basePpm, bio.progress);
        console.log(
          `🎯 Protocol | Phase: ${bio.stage} | Target: ${baseTarget.toFixed(0)} PPM`,
        );
      }

      if (currentStatus.isTankEmpty) {
        console.warn(
          "⚠️ POT EMPTY: Triggering emergency RO water top-off batch!",
        );
        await this.evaluateAndDose(
          livePH,
          livePPM,
          baseTarget,
          bio.stage,
          state.currentDay,
          state.sysVol,
          true,
        );
        return;
      }

      await this.evaluateAndDose(
        livePH,
        livePPM,
        baseTarget,
        bio.stage,
        state.currentDay,
        state.sysVol,
        false,
      );
    } catch (error) {
      console.error("❌ Recipe Engine Error:", error);
      this.mqtt.sendCommand("stop");
    } finally {
      this.isTicking = false;
    }
  }

  async executePumpAndWait(pumpName, actionStr, amountMl) {
    if (amountMl <= 0.5) return 0;
    const isWater = pumpName.toLowerCase().includes("water");
    const safeMl = isWater ? amountMl : Math.min(15.0, amountMl);
    const flowRate = 20.0;

    if (await Watchdog.isSafeToDose(pumpName, safeMl)) {
      console.log(
        `⏳ Locking Manifold: ${pumpName} (${safeMl.toFixed(1)}ml)...`,
      );

      let remainingMl = safeMl;

      while (remainingMl > 0.5) {
        await this.mqtt.waitForDevice("pump_node_1");
        // Small delay to let the pump's MQTT loop stabilise after reconnect
        await new Promise((resolve) => setTimeout(resolve, 500));

        let startTime = Date.now();
        try {
          this.mqtt.sendCommand(actionStr, remainingMl);
          // Wait for pump to confirm it is busy (command received)
          await this.mqtt.waitForBusy(10000);
          // Wait for pump to finish
          await this.mqtt.waitForIdle();
          remainingMl = 0;
        } catch (err) {
          if (err.message === "OFFLINE_INTERRUPT") {
            let elapsedMs = Date.now() - startTime;
            let pumpedMl = (elapsedMs / 1000) * flowRate;
            remainingMl -= pumpedMl;
            if (remainingMl > 0.5) {
              console.warn(
                `⚠️ Network Crash! Pumped approx ${pumpedMl.toFixed(1)}ml. Waiting for reconnect to push remaining ${remainingMl.toFixed(1)}ml.`,
              );
            }
          } else {
            throw err;
          }
        }
      }
      await Watchdog.logSuccessfulDose(pumpName, safeMl);
      return safeMl;
    }
    return 0;
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

      const rawDose = this.calculateDeficitMath(
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
              '{"carrierFluid":"Fresh_Water","carrierVolumeMl":500,"mixingSequence":[]}',
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
        await this.executePumpAndWait("Fresh_Water", "dose_water", dilutionMl);

        const blowoutVolume = dilutionMl * 1.2;
        console.log(
          `🌊 Delivering ${dilutionMl.toFixed(1)}ml pure water (Blowout ${blowoutVolume.toFixed(1)}ml) to Pot A...`,
        );

        await this.mqtt.waitForIdle();
        this.mqtt.sendCommand("deliver", blowoutVolume, "A");
        await this.mqtt.waitForIdle();

        console.log(`✅ --- DILUTION SEQUENCE COMPLETE --- \n`);
        return; // EXIT: Do not touch pH.
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
        await this.executePumpAndWait("Fresh_Water", "dose_water", 250.0);
        const actualAcid = await this.executePumpAndWait(type, topic, 2.0);

        const totalVolume = 250.0 + actualAcid;
        const blowoutVolume = totalVolume * 1.2;

        this.mqtt.sendCommand("deliver", blowoutVolume, "A");
        await this.mqtt.waitForIdle();
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
