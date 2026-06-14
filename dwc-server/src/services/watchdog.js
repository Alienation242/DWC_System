const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

class Watchdog {
  static async isSafeToDose(pumpName, ml, potId = "A") {
    const isWater = pumpName.toLowerCase().includes("water");
    if (isWater) return true; // Water is always safe, no config

    let config = await prisma.watchdogConfig.findUnique({
      where: { pumpName },
    });
    if (!config) {
      config = await prisma.watchdogConfig.create({
        data: { pumpName, dailyLimitMl: 15.0, cooldownSecs: 30, enabled: true },
      });
    }
    if (!config.enabled) return false;

    // Cooldown check per pot
    const lastDose = await prisma.doseLog.findFirst({
      where: { pumpName, potId, status: "SUCCESS" },
      orderBy: { timestamp: "desc" },
    });
    if (
      lastDose &&
      Date.now() - lastDose.timestamp.getTime() < config.cooldownSecs * 1000
    ) {
      console.warn(`⏳ Cooldown active for ${pumpName} on pot ${potId}`);
      return false;
    }

    // Daily limit check per pot
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const aggregate = await prisma.doseLog.aggregate({
      where: { pumpName, potId, timestamp: { gte: startOfDay } },
      _sum: { ml: true },
    });
    const totalToday = aggregate._sum.ml || 0;
    if (totalToday + ml > config.dailyLimitMl) {
      console.warn(`🚫 Daily limit exceeded for ${pumpName} on pot ${potId}`);
      return false;
    }
    return true;
  }

  static async logSuccessfulDose(pumpName, ml, potId = "A") {
    await prisma.doseLog.create({
      data: { pumpName, ml, potId, status: "SUCCESS" },
    });
  }
}

module.exports = Watchdog;
