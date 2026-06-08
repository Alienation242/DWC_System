const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function seed() {
  await prisma.systemState.upsert({
    where: { id: 1 },
    update: {},
    create: {
      currentStrain: "auto_kush",
      currentProfilePath: "./recipes/default.json",
      currentDay: 1,
      automationMode: "AUTOMATED",
      sysVol: 18.0,
    },
  });

  const pumps = [
    "pH_Down",
    "pH_Up",
    "Micro",
    "Bloom",
    "CalMag",
    "Gro",
    "Finisher",
  ];
  for (const pump of pumps) {
    await prisma.watchdogConfig.upsert({
      where: { pumpName: pump },
      update: {},
      create: {
        pumpName: pump,
        dailyLimitMl: 15.0,
        cooldownSecs: 30,
        enabled: true,
      },
    });
  }
  console.log("✅ Seeded SystemState and WatchdogConfigs");
}

seed();
