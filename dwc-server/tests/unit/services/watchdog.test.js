const Watchdog = require("../../../src/services/watchdog");
const { mockPrisma } = global;

describe("Watchdog Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test("creates config if missing", async () => {
    mockPrisma.watchdogConfig.findUnique.mockResolvedValue(null);
    mockPrisma.watchdogConfig.create.mockResolvedValue({
      enabled: true,
      cooldownSecs: 30,
      dailyLimitMl: 15,
    });
    mockPrisma.doseLog.aggregate.mockResolvedValue({ _sum: { ml: 0 } });
    mockPrisma.doseLog.findFirst.mockResolvedValue(null);
    const safe = await Watchdog.isSafeToDose("Unknown", 5);
    expect(mockPrisma.watchdogConfig.create).toHaveBeenCalled();
    expect(safe).toBe(true);
  });

  test("respects disabled config", async () => {
    mockPrisma.watchdogConfig.findUnique.mockResolvedValue({ enabled: false });
    const safe = await Watchdog.isSafeToDose("pH_Down", 2);
    expect(safe).toBe(false);
  });

  test("enforces cooldown", async () => {
    mockPrisma.watchdogConfig.findUnique.mockResolvedValue({
      enabled: true,
      cooldownSecs: 30,
    });
    mockPrisma.doseLog.findFirst.mockResolvedValue({
      timestamp: new Date(Date.now() - 20000),
    });
    const safe = await Watchdog.isSafeToDose("Micro", 5);
    expect(safe).toBe(false);
  });

  test("bypasses cooldown after enough time", async () => {
    mockPrisma.watchdogConfig.findUnique.mockResolvedValue({
      enabled: true,
      cooldownSecs: 30,
    });
    mockPrisma.doseLog.findFirst.mockResolvedValue({
      timestamp: new Date(Date.now() - 40000),
    });
    mockPrisma.doseLog.aggregate.mockResolvedValue({ _sum: { ml: 0 } });
    const safe = await Watchdog.isSafeToDose("Gro", 10);
    expect(safe).toBe(true);
  });

  test("enforces daily limit for non‑water", async () => {
    mockPrisma.watchdogConfig.findUnique.mockResolvedValue({
      enabled: true,
      dailyLimitMl: 100,
    });
    mockPrisma.doseLog.aggregate.mockResolvedValue({ _sum: { ml: 95 } });
    const safe = await Watchdog.isSafeToDose("Bloom", 10);
    expect(safe).toBe(false);
  });

  test("bypasses daily limit for water", async () => {
    const safe = await Watchdog.isSafeToDose("Water", 5000);
    expect(safe).toBe(true);
  });

  test("logs successful dose", async () => {
    await Watchdog.logSuccessfulDose("CalMag", 12.5);
    expect(mockPrisma.doseLog.create).toHaveBeenCalledWith({
      data: { pumpName: "CalMag", ml: 12.5, status: "SUCCESS" },
    });
  });

  test("water does not create config and is always safe", async () => {
    const safe = await Watchdog.isSafeToDose("Water", 5000);
    expect(safe).toBe(true);
    expect(mockPrisma.watchdogConfig.create).not.toHaveBeenCalled();
  });
});
