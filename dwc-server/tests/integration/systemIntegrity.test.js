const RecipeEngine = require("../../src/services/recipeEngine");
const Watchdog = require("../../src/services/watchdog");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
jest.mock("@prisma/client", () => {
  const mPrisma = {
    watchdogConfig: { findUnique: jest.fn() },
    doseLog: { findFirst: jest.fn(), aggregate: jest.fn(), create: jest.fn() },
    batchState: { findFirst: jest.fn() },
  };
  return { PrismaClient: jest.fn(() => mPrisma) };
});

describe("System Integrity - Watchdog & Database Constraints", () => {
  let engine;

  beforeEach(() => {
    engine = new RecipeEngine(null);
    jest.clearAllMocks();
    // Silence the console noise
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("1. COOLDOWN ENFORCEMENT: Watchdog blocks rapid-fire dosing", async () => {
    const now = Date.now();
    prisma.doseLog.findFirst.mockResolvedValue({
      timestamp: new Date(now - 10000),
    });
    prisma.watchdogConfig.findUnique.mockResolvedValue({
      enabled: true,
      cooldownSecs: 30,
    });

    const isSafe = await Watchdog.isSafeToDose("Micro", 2.0);
    expect(isSafe).toBe(false);
  });

  test("2. DAILY LIMIT ENFORCEMENT: Watchdog blocks if daily limit exceeded", async () => {
    prisma.watchdogConfig.findUnique.mockResolvedValue({
      enabled: true,
      dailyLimitMl: 10.0,
    });
    prisma.doseLog.aggregate.mockResolvedValue({ _sum: { ml: 12.0 } });

    const isSafe = await Watchdog.isSafeToDose("Micro", 2.0);
    expect(isSafe).toBe(false);
  });

  test("3. DATABASE LOGGING: Engine aborts if watchdog is unsafe", async () => {
    // Correct way to mock the static method on the class
    const spy = jest.spyOn(Watchdog, "isSafeToDose").mockResolvedValue(false);

    const result = await engine.executePumpAndWait(
      "pH_Down",
      "dose_ph_down",
      5.0,
    );

    expect(result).toBe(0);
    expect(prisma.doseLog.create).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
