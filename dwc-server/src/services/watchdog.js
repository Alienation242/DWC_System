const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const lastDoseTime = {};

class Watchdog {
  static async isSafeToDose(pumpName, ml) {
    let config = await prisma.watchdogConfig.findUnique({
      where: { pumpName },
    });
    if (!config) {
      config = await prisma.watchdogConfig.create({
        data: { pumpName, dailyLimitMl: 15.0, cooldownSecs: 30 },
      });
    }
    if (!config.enabled) return false;

    const last = lastDoseTime[pumpName];
    if (last && Date.now() - last < config.cooldownSecs * 1000) {
      console.warn(`⏳ Cooldown active for ${pumpName}`);
      return false;
    }

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const aggregate = await prisma.doseLog.aggregate({
      where: {
        pumpName,
        timestamp: { gte: startOfDay },
      },
      _sum: { ml: true },
    });
    const totalToday = aggregate._sum.ml || 0;
    if (totalToday + ml > config.dailyLimitMl) {
      console.warn(`🚫 Daily limit exceeded for ${pumpName}`);
      return false;
    }
    return true;
  }

  static async logSuccessfulDose(pumpName, ml) {
    await prisma.doseLog.create({
      data: { pumpName, ml, status: "SUCCESS" },
    });
    lastDoseTime[pumpName] = Date.now();
    console.log(`✅ Watchdog: logged ${ml}ml for ${pumpName}`);
  }

  static async getDailyUsed(pumpName) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const agg = await prisma.doseLog.aggregate({
      where: { pumpName, timestamp: { gte: startOfDay } },
      _sum: { ml: true },
    });
    return agg._sum.ml || 0;
  }
}

module.exports = Watchdog;
