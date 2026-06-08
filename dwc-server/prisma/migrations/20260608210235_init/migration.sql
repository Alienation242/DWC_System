-- CreateTable
CREATE TABLE "TelemetryLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPH" REAL NOT NULL,
    "rawEC" REAL NOT NULL,
    "isTankEmpty" BOOLEAN NOT NULL,
    "isTankOverflowing" BOOLEAN NOT NULL
);

-- CreateTable
CREATE TABLE "SystemState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "currentStrain" TEXT NOT NULL DEFAULT 'auto_kush',
    "currentProfilePath" TEXT NOT NULL DEFAULT './recipes/default.json',
    "cycleStartDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentDay" INTEGER NOT NULL DEFAULT 1,
    "automationMode" TEXT NOT NULL DEFAULT 'AUTOMATED',
    "lastDoseTime" DATETIME,
    "sysVol" REAL NOT NULL DEFAULT 18.0
);

-- CreateTable
CREATE TABLE "DoseLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pumpName" TEXT NOT NULL,
    "ml" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS'
);

-- CreateTable
CREATE TABLE "WatchdogConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pumpName" TEXT NOT NULL,
    "dailyLimitMl" REAL NOT NULL DEFAULT 15.0,
    "cooldownSecs" INTEGER NOT NULL DEFAULT 30,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchdogConfig_pumpName_key" ON "WatchdogConfig"("pumpName");
