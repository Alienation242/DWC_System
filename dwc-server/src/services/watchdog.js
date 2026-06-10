const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

class Watchdog {
  static async isSafeToDose(pumpName, ml) {
    const isWater = pumpName.toLowerCase().includes("water");
    if (isWater) return true; // Water is always safe, no config

    let config = await prisma.watchdogConfig.findUnique({
      where: { pumpName },
    });
    if (!config) {
      config = await prisma.watchdogConfig.create({
        data: { pumpName, dailyLimitMl: 15.0, cooldownSecs: 30 },
      });
    }
    if (!config.enabled) return false;

    const lastDose = await prisma.doseLog.findFirst({
      where: { pumpName, status: "SUCCESS" },
      orderBy: { timestamp: "desc" },
    });

    if (
      lastDose &&
      Date.now() - lastDose.timestamp.getTime() < config.cooldownSecs * 1000
    ) {
      console.warn(`⏳ Cooldown active for ${pumpName}`);
      return false;
    }

    // Daily limit check (non‑water only – water already returned)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const aggregate = await prisma.doseLog.aggregate({
      where: { pumpName, timestamp: { gte: startOfDay } },
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
  }
}

module.exports = Watchdog;
