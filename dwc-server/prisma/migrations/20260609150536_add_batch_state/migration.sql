-- CreateTable
CREATE TABLE "BatchState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "batchType" TEXT NOT NULL,
    "totalWaterMl" REAL NOT NULL,
    "confirmedWaterMl" REAL NOT NULL DEFAULT 0,
    "totalNutrients" TEXT,
    "confirmedNutrients" TEXT,
    "targetPot" TEXT DEFAULT 'A',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdate" DATETIME NOT NULL
);
