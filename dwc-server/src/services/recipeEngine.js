const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const Watchdog = require("./watchdog");
const fs = require("fs").promises;
const path = require("path");
const CalibrationService = require("./calibrationService");

const TARGET_PH = 5.8;
const CALMAG_PPM_PER_ML_L = 375.0;
const BASE_PPM_PER_ML_L = 136.4;

class RecipeEngine {
  constructor(mqttService) {
    this.mqtt = mqttService;
  }

  mapValue(x, in_min, in_max, out_min, out_max) {
    return ((x - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;
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

      // Wait for at least one telemetry record
      const count = await prisma.telemetryLog.count();
      if (count === 0) {
        console.log("⏳ Waiting for first telemetry...");
        return;
      }

      // Get latest telemetry for tank safety
      const latestTele = await prisma.telemetryLog.findFirst({
        orderBy: { timestamp: "desc" },
      });
      if (latestTele?.isTankEmpty) {
        console.warn("⚠️ Reservoir empty! Skipping tick.");
        return;
      }

      const recentLogs = await prisma.telemetryLog.findMany({
        take: 5,
        orderBy: { timestamp: "desc" },
      });

      const avgRawPH =
        recentLogs.reduce((s, l) => s + l.rawPH, 0) / recentLogs.length;
      const avgRawEC =
        recentLogs.reduce((s, l) => s + l.rawEC, 0) / recentLogs.length;

      // Convert using CalibrationService (no manual clamping needed)
      const livePH = await CalibrationService.convertPH(avgRawPH);
      const livePPM = await CalibrationService.convertEC(avgRawEC);

      console.log(
        `📊 Live | pH: ${livePH.toFixed(2)} | PPM: ${Math.round(livePPM)}`,
      );

      // Load strain profile
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

  async evaluateAndDose(livePH, livePPM, targetPPM, stage, currentDay, sysVol) {
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
          const safeMl = Math.min(15.0, amountMl);
          if (await Watchdog.isSafeToDose(pumpName, safeMl)) {
            this.mqtt.sendCommand(topicStr, safeMl);
            await Watchdog.logSuccessfulDose(pumpName, safeMl);
          } else {
            console.warn(`⚠️ Watchdog blocked ${pumpName} (${safeMl}ml)`);
          }
        }
      };

      await executePump("Micro", "dose_micro", dose.micro);
      await executePump("Bloom", "dose_bloom", dose.bloom);
      await executePump("CalMag", "dose_calmag", dose.cal);

      if (stage === "RIPENING") {
        console.log("⚠️ [MULTIPLEXER] Using FINISHER bottle on Relay 5.");
        await executePump("Finisher", "dose_gro_fin_relay", dose.fin);
      } else {
        console.log("⚠️ [MULTIPLEXER] Using GRO bottle on Relay 5.");
        await executePump("Gro", "dose_gro_fin_relay", dose.gro);
      }
      return;
    }

    // pH correction only when EC is stable
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
