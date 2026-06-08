const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const Watchdog = require("./watchdog");
const fs = require("fs").promises;
const path = require("path");

// ==========================================
// 1. CHEMISTRY & SYSTEM CONSTANTS
// ==========================================
const TARGET_PH = 5.8;
const CALMAG_PPM_PER_ML_L = 375.0; // PPM yield per 1ml in 1 Liter
const BASE_PPM_PER_ML_L = 136.4; // PPM yield per 1ml in 1 Liter

// Hardware Calibration (Update with real voltage tests later)
const CALIBRATION = {
  pH: { rawLow: 1093, realLow: 4.0, rawHigh: 1973, realHigh: 7.0 },
  EC: { rawLow: 1305, realLow: 0.0, rawHigh: 2110, realHigh: 1000.0 },
};

class RecipeEngine {
  constructor(mqttService) {
    this.mqtt = mqttService;
  }

  mapValue(x, in_min, in_max, out_min, out_max) {
    return ((x - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;
  }

  // Parses the dynamic JSON curves
  resolveCurve(param, progress) {
    if (!param) return 0;
    progress = Math.max(0, Math.min(1, progress));
    return (
      param.start +
      (param.end - param.start) * Math.pow(progress, param.curve || 1.0)
    );
  }

  /**
   * Evaluates the biological stage and calculates progress percentages
   */
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

  /**
   * EXACT PORT: Calculates Terra Aquatica Deficits using your engine.js math
   */
  calculateDeficitMath(targetPPM, deficitPPM, stage, exactDays, sysVol) {
    // 1. Determine the ideal target ratio for the day
    const targetCalPpm = stage === "VEGETATIVE" ? 150 : 250;
    const idealCalMagPpm = Math.min(targetPPM, targetCalPpm);
    const idealBasePpm = Math.max(0, targetPPM - idealCalMagPpm);

    // 2. Map that ratio directly to the missing deficit
    const deficitRatioCal = idealCalMagPpm / targetPPM;
    const deficitRatioBase = idealBasePpm / targetPPM;

    const ppmNeededCal = deficitPPM * deficitRatioCal;
    const ppmNeededBase = deficitPPM * deficitRatioBase;

    // 3. Convert missing PPM to exact milliliters for the entire system volume
    const calMag_ml = (ppmNeededCal / CALMAG_PPM_PER_ML_L) * sysVol;
    const totalBase_ml = (ppmNeededBase / BASE_PPM_PER_ML_L) * sysVol;

    let gro = 0,
      micro = 0,
      bloom = 0,
      fin = 0;

    // 4. Split the base ML based on phase biology (Exact port from engine.js)
    if (stage === "RIPENING") {
      fin = totalBase_ml; // 100% Finisher
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
      if (state.automationMode === "MANUAL_OVERRIDE")
        return console.log("⚠️ Manual Override Active.");

      const recentLogs = await prisma.telemetryLog.findMany({
        take: 5,
        orderBy: { timestamp: "desc" },
      });
      if (recentLogs.length === 0)
        return console.log("⚠️ No telemetry available.");

      // Smooth sensor noise
      const avgRawPH =
        recentLogs.reduce((sum, log) => sum + log.rawPH, 0) / recentLogs.length;
      const avgRawEC =
        recentLogs.reduce((sum, log) => sum + log.rawEC, 0) / recentLogs.length;

      const livePH = this.mapValue(
        avgRawPH,
        CALIBRATION.pH.rawLow,
        CALIBRATION.pH.rawHigh,
        CALIBRATION.pH.realLow,
        CALIBRATION.pH.realHigh,
      );
      const livePPM = this.mapValue(
        avgRawEC,
        CALIBRATION.EC.rawLow,
        CALIBRATION.EC.rawHigh,
        CALIBRATION.EC.realLow,
        CALIBRATION.EC.realHigh,
      );

      console.log(
        `📊 Live | pH: ${livePH.toFixed(2)} | PPM: ${livePPM.toFixed(0)}`,
      );

      // Load Profile (Hardcoded for testing, will link to DB state later)
      const profilePath = path.join(
        __dirname,
        "../../recipes/candy_games.json",
      );
      const strainData = JSON.parse(await fs.readFile(profilePath, "utf8"));

      const bio = this.getBiologicalStage(state.currentDay, strainData);

      if (bio.stage === "FLUSH") {
        console.log("💧 FLUSH STAGE: 0 PPM Target. Bypassing nutrients.");
        return;
      }

      // Calculate exact PPM target for today based on the JSON curve
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
        18,
      ); // Assumed 18L System Vol
    } catch (error) {
      console.error("❌ Recipe Engine Error:", error);
    }
  }

  async evaluateAndDose(livePH, livePPM, targetPPM, stage, currentDay, sysVol) {
    // --- A. EC PRIORITY (Fix Nutrient Deficits First) ---
    if (livePPM < targetPPM - 50) {
      const deficitPPM = targetPPM - livePPM;
      console.log(`📉 EC Deficit Detected (-${deficitPPM.toFixed(0)} PPM)`);

      const dose = this.calculateDeficitMath(
        targetPPM,
        deficitPPM,
        stage,
        currentDay,
        sysVol,
      );

      console.log(
        `🧪 Batching: Cal:${dose.cal.toFixed(1)}ml | Gro:${dose.gro.toFixed(1)}ml | Mic:${dose.micro.toFixed(1)}ml | Blo:${dose.bloom.toFixed(1)}ml | Fin:${dose.fin.toFixed(1)}ml`,
      );

      const executePump = async (pumpName, topicStr, amountMl) => {
        if (amountMl > 0.5) {
          const safeMl = Math.min(15.0, amountMl); // Hard cap 15ml per tick to prevent spikes
          if (await Watchdog.isSafeToDose(pumpName, safeMl)) {
            this.mqtt.sendCommand(topicStr, safeMl);
            await Watchdog.logSuccessfulDose(pumpName, safeMl);
          }
        }
      };

      // Execute standard pumps
      await executePump("Micro", "dose_micro", dose.micro);
      await executePump("Bloom", "dose_bloom", dose.bloom);
      await executePump("CalMag", "dose_calmag", dose.cal); // Will safely bypass if hardware isn't linked

      // ==========================================
      // VIRTUAL PUMP MULTIPLEXING (Gro / Finisher Swap)
      // Both commands output to the same physical relay topic.
      // ==========================================
      if (stage === "RIPENING") {
        console.log(
          "⚠️ [MULTIPLEXER ALERT]: Expecting FINISHER bottle on physical Relay 5.",
        );
        await executePump("Finisher", "dose_gro_fin_relay", dose.fin);
      } else {
        console.log(
          "⚠️ [MULTIPLEXER ALERT]: Expecting GRO bottle on physical Relay 5.",
        );
        await executePump("Gro", "dose_gro_fin_relay", dose.gro);
      }

      // Nutrients alter pH drastically. Do not adjust pH during this tick.
      return;
    }

    // --- B. pH CORRECTION (Only executed if EC is stable) ---
    if (livePH > TARGET_PH + 0.2) {
      if (await Watchdog.isSafeToDose("pH_Down", 2.0)) {
        this.mqtt.sendCommand("dose_ph_down", 2.0);
        await Watchdog.logSuccessfulDose("pH_Down", 2.0);
      }
    } else if (livePH < TARGET_PH - 0.2) {
      if (await Watchdog.isSafeToDose("pH_Up", 2.0)) {
        this.mqtt.sendCommand("dose_ph_up", 2.0);
        await Watchdog.logSuccessfulDose("pH_Up", 2.0);
      }
    } else {
      console.log("✅ System Stable. No action required.");
    }
  }
}

module.exports = RecipeEngine;
