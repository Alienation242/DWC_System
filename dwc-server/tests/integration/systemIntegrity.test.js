const RecipeEngine = require("../../src/services/recipeEngine");
const Watchdog = require("../../src/services/watchdog");
const mockPrisma = require("../../mocks/mockPrisma");

describe("System Integrity - Watchdog & Database Constraints", () => {
  let engine;
  beforeEach(() => {
    engine = new RecipeEngine(null);
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test("COOLDOWN ENFORCEMENT", async () => {
    mockPrisma.doseLog.findFirst.mockResolvedValue({
      timestamp: new Date(Date.now() - 10000),
    });
    mockPrisma.watchdogConfig.findUnique.mockResolvedValue({
      enabled: true,
      cooldownSecs: 30,
    });
    const isSafe = await Watchdog.isSafeToDose("Micro", 2.0);
    expect(isSafe).toBe(false);
  });

  test("DAILY LIMIT ENFORCEMENT", async () => {
    mockPrisma.watchdogConfig.findUnique.mockResolvedValue({
      enabled: true,
      dailyLimitMl: 10.0,
    });
    mockPrisma.doseLog.aggregate.mockResolvedValue({ _sum: { ml: 12.0 } });
    const isSafe = await Watchdog.isSafeToDose("Micro", 2.0);
    expect(isSafe).toBe(false);
  });

  test("DATABASE LOGGING: Engine aborts if watchdog is unsafe", async () => {
    const spy = jest.spyOn(Watchdog, "isSafeToDose").mockResolvedValue(false);
    const result = await engine.executePumpAndWait(
      "pH_Down",
      "dose_ph_down",
      5.0,
    );
    expect(result).toBe(0);
    expect(mockPrisma.doseLog.create).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
