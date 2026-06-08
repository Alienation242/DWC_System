/*
  Warnings:

  - Added the required column `realEC` to the `TelemetryLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `realPH` to the `TelemetryLog` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TelemetryLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPH" REAL NOT NULL,
    "rawEC" REAL NOT NULL,
    "realPH" REAL NOT NULL,
    "realEC" REAL NOT NULL,
    "isTankEmpty" BOOLEAN NOT NULL,
    "isTankOverflowing" BOOLEAN NOT NULL
);
INSERT INTO "new_TelemetryLog" ("id", "isTankEmpty", "isTankOverflowing", "rawEC", "rawPH", "timestamp") SELECT "id", "isTankEmpty", "isTankOverflowing", "rawEC", "rawPH", "timestamp" FROM "TelemetryLog";
DROP TABLE "TelemetryLog";
ALTER TABLE "new_TelemetryLog" RENAME TO "TelemetryLog";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
