const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const Watchdog = require("./watchdog");
const fs = require("fs").promises;
const path = require("path");
const HARDWARE_CONFIG_PATH = path.join(
  process.cwd(),
  "config",
  "hardware.json",
);

const TARGET_PH = 5.8;
const CALMAG_PPM_PER_ML_L = 375.0;
const BASE_PPM_PER_ML_L = 136.4;

// Path to our new mixing sequence configuration
const NUTRIENT_PROFILE_PATH = path.join(
  process.cwd(),
  "config",
  "nutrient_profile.json",
);

let hardwareConfig = null;

async function loadHardwareConfig() {
  if (hardwareConfig) return hardwareConfig;
  try {
    const data = await fs.readFile(HARDWARE_CONFIG_PATH, "utf8");
    hardwareConfig = JSON.parse(data);
    return hardwareConfig;
  } catch {
    console.warn("⚠️ Using default hardware config (2 ml/s)");
    hardwareConfig = {
      peristaltic_ml_per_sec: 2.0,
      submersible_ml_per_sec: 50.0,
      safety_buffer_ms: 30000,
    };
    return hardwareConfig;
  }
}
class RecipeEngine {
  constructor(mqttService) {
    this.mqtt = mqttService;
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
    const targetCalPpm = stage === "VEGETATIVE" ? 150 : 250;
    const idealCalMagPpm = Math.min(targetPPM, targetCalPpm);
    const idealBasePpm = Math.max(0, targetPPM - idealCalMagPpm);

    const deficitRatioCal = idealCalMagPpm / targetPPM;
    const deficitRatioBase = idealBasePpm / targetPPM;

    const ppmNeededCal = deficitPPM * deficitRatioCal;
    const ppmNeededBase = deficitPPM * deficitRatioBase;

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
    console.log("\n--- 🧠 [RECIPE ENGINE] TICK INITIATED ---");
    try {
      const state = await prisma.systemState.findUnique({ where: { id: 1 } });
      if (!state) {
        console.error("❌ No SystemState found. Run seed script.");
        return;
      }
      if (state.automationMode === "MANUAL_OVERRIDE") {
        console.log("⚠️ Manual Override Active.");
        return;
      }

      // TIME FILTER: Only accept logs from the last 2 minutes to prevent cross-session contamination
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

      const recentLogs = await prisma.telemetryLog.findMany({
        take: 5,
        where: { timestamp: { gte: twoMinutesAgo } },
        orderBy: { timestamp: "desc" },
      });

      if (recentLogs.length === 0) {
        console.log("⏳ Waiting for fresh telemetry. Engine skipping tick.");
        return;
      }

      if (recentLogs[0].isTankEmpty) {
        console.warn("⚠️ Reservoir empty! Skipping tick to protect main pump.");
        return;
      }

      // Smooth the pre-calculated real values directly from the database
      const livePH =
        recentLogs.reduce((s, l) => s + l.realPH, 0) / recentLogs.length;
      const livePPM =
        recentLogs.reduce((s, l) => s + l.realEC, 0) / recentLogs.length;

      console.log(
        `📊 Live | pH: ${livePH.toFixed(2)} | PPM: ${Math.round(livePPM)}`,
      );

      const profilePath = path.join(process.cwd(), state.currentProfilePath);
      let strainData;
      try {
        const raw = await fs.readFile(profilePath, "utf8");
        strainData = JSON.parse(raw);
      } catch (err) {
        console.error(
          `❌ Cannot load profile from ${profilePath}`,
          err.message,
        );
        return;
      }

      const bio = this.getBiologicalStage(state.currentDay, strainData);
      if (bio.stage === "FLUSH") {
        console.log("💧 FLUSH STAGE: 0 PPM Target. Bypassing nutrients.");
        return;
      }

      const baseTarget = this.resolveCurve(bio.data.basePpm, bio.progress);
      console.log(
        `🎯 Target Protocol | Phase: ${bio.stage} | Target PPM: ${baseTarget.toFixed(0)}`,
      );

      await this.evaluateAndDose(
        livePH,
        livePPM,
        baseTarget,
        bio.stage,
        state.currentDay,
        state.sysVol,
      );
    } catch (error) {
      console.error("❌ Recipe Engine Error:", error);
    }
  }

  async executePumpAndWait(pumpName, actionStr, amountMl) {
    if (amountMl <= 0.5) return 0;

    // Exempt RO Water from the 15ml safety cap!
    const isWater =
      pumpName === "Fresh_Water" ||
      pumpName === "RO Water" ||
      pumpName === "Water";
    const safeMl = isWater ? amountMl : Math.min(15.0, amountMl);

    if (await Watchdog.isSafeToDose(pumpName, safeMl)) {
      const hw = await loadHardwareConfig();
      const expectedDurationMs = (safeMl / hw.peristaltic_ml_per_sec) * 1000;
      const timeoutMs = expectedDurationMs + hw.safety_buffer_ms;

      console.log(
        `⏳ Waiting for ${pumpName} (${safeMl.toFixed(1)}ml) - expected ${expectedDurationMs / 1000}s, timeout ${timeoutMs / 1000}s`,
      );
      await this.mqtt.waitForIdle(timeoutMs);
      this.mqtt.sendCommand(actionStr, safeMl);
      await this.mqtt.waitForIdle(timeoutMs);
      await Watchdog.logSuccessfulDose(pumpName, safeMl);
      return safeMl;
    } else {
      console.warn(`⚠️ Watchdog blocked ${pumpName} (${safeMl}ml)`);
      throw new Error(`Watchdog blocked ${pumpName}`);
    }
  }

  async evaluateAndDose(livePH, livePPM, targetPPM, stage, currentDay, sysVol) {
    // DYNAMIC DEADBAND: 10% of target, capped between 15 and 50 PPM
    const deadbandPPM = Math.max(15, Math.min(50, targetPPM * 0.1));

    if (livePPM < targetPPM - deadbandPPM) {
      const deficitPPM = targetPPM - livePPM;
      console.log(
        `📉 EC Deficit Detected (-${deficitPPM.toFixed(0)} PPM) | Deadband: ±${deadbandPPM.toFixed(0)} PPM`,
      );

      const dose = this.calculateDeficitMath(
        targetPPM,
        deficitPPM,
        stage,
        currentDay,
        sysVol,
      );

      let nutConfig;
      try {
        const rawConfig = await fs.readFile(NUTRIENT_PROFILE_PATH, "utf8");
        nutConfig = JSON.parse(rawConfig);
      } catch (err) {
        console.error(
          "⚠️ Failed to load nutrient_profile.json! Falling back to defaults.",
        );
        nutConfig = {
          carrierFluid: "Water",
          carrierVolumeMl: 500,
          mixingSequence: ["CalMag", "Micro", "Gro", "Bloom", "Finisher"],
        };
      }

      console.log(`\n🚀 --- INITIATING MIXING BATCH ---`);
      console.log(
        `💧 Step 1: Pumping ${nutConfig.carrierVolumeMl}ml ${nutConfig.carrierFluid} Carrier...`,
      );

      await this.executePumpAndWait(
        nutConfig.carrierFluid,
        "dose_water",
        nutConfig.carrierVolumeMl,
      );

      console.log(
        `🧪 Step 2: Sequentially Injecting Nutrients into Batch Tank...`,
      );
      let totalInjected = 0;

      const doseMap = {
        CalMag: { topic: "dose_calmag", amount: dose.cal },
        Micro: { topic: "dose_micro", amount: dose.micro },
        Gro: { topic: "dose_gro_fin_relay", amount: dose.gro },
        Bloom: { topic: "dose_bloom", amount: dose.bloom },
        Finisher: { topic: "dose_gro_fin_relay", amount: dose.fin },
      };

      for (const nutrientName of nutConfig.mixingSequence) {
        const doseInfo = doseMap[nutrientName];
        if (doseInfo && doseInfo.amount > 0.5) {
          if (nutrientName === "Gro" || nutrientName === "Finisher") {
            console.log(
              `⚠️ [MULTIPLEXER] System expects the ${nutrientName.toUpperCase()} bottle on Relay 5.`,
            );
          }
          totalInjected += await this.executePumpAndWait(
            nutrientName,
            doseInfo.topic,
            doseInfo.amount,
          );
        }
      }

      const targetPot = "A";
      const totalBatchVolume = nutConfig.carrierVolumeMl + totalInjected;

      console.log(
        `🌊 Step 3: Delivering ${totalBatchVolume.toFixed(1)}ml Batch to Pot ${targetPot}...`,
      );
      await this.mqtt.waitForIdle();
      this.mqtt.sendCommand("deliver", totalBatchVolume, targetPot);
      await this.mqtt.waitForIdle();

      console.log(`✅ --- BATCH SEQUENCE COMPLETE --- \n`);
      return;
    }

    if (livePH > TARGET_PH + 0.2) {
      console.log(`\n🚀 --- INITIATING pH DOWN BATCH ---`);
      await this.executePumpAndWait("Water", "dose_water", 250.0);
      await this.executePumpAndWait("pH_Down", "dose_ph_down", 2.0);
      this.mqtt.sendCommand("deliver", 250.0 + 2.0, "A");
      await this.mqtt.waitForIdle();
      console.log(`✅ pH Correction Complete.`);
    } else if (livePH < TARGET_PH - 0.2) {
      console.log(`\n🚀 --- INITIATING pH UP BATCH ---`);
      await this.executePumpAndWait("Water", "dose_water", 250.0);
      await this.executePumpAndWait("pH_Up", "dose_ph_up", 2.0);
      this.mqtt.sendCommand("deliver", 250.0 + 2.0, "A");
      await this.mqtt.waitForIdle();
      console.log(`✅ pH Correction Complete.`);
    } else {
      console.log(`✅ System Stable. No batch required.`);
    }
  }
}

module.exports = RecipeEngine;
