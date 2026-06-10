const Watchdog = require("../../../src/services/watchdog");
const { PrismaClient } = require("@prisma/client");

jest.mock("@prisma/client", () => {
  const mPrisma = {
    watchdogConfig: { findUnique: jest.fn(), create: jest.fn() },
    doseLog: { findFirst: jest.fn(), aggregate: jest.fn(), create: jest.fn() },
  };
  return { PrismaClient: jest.fn(() => mPrisma) };
});

const prisma = new PrismaClient();

describe("Watchdog Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  test("creates config if missing", async () => {
    prisma.watchdogConfig.findUnique.mockResolvedValue(null);
    prisma.watchdogConfig.create.mockResolvedValue({
      enabled: true,
      cooldownSecs: 30,
      dailyLimitMl: 15,
    });
    prisma.doseLog.aggregate.mockResolvedValue({ _sum: { ml: 0 } });
    prisma.doseLog.findFirst.mockResolvedValue(null);

    const safe = await Watchdog.isSafeToDose("Unknown", 5);
    expect(prisma.watchdogConfig.create).toHaveBeenCalled();
    expect(safe).toBe(true);
  });

  test("respects disabled config", async () => {
    prisma.watchdogConfig.findUnique.mockResolvedValue({ enabled: false });
    const safe = await Watchdog.isSafeToDose("pH_Down", 2);
    expect(safe).toBe(false);
  });

  test("enforces cooldown", async () => {
    const lastDose = { timestamp: new Date(Date.now() - 20000) };
    prisma.watchdogConfig.findUnique.mockResolvedValue({
      enabled: true,
      cooldownSecs: 30,
    });
    prisma.doseLog.findFirst.mockResolvedValue(lastDose);
    const safe = await Watchdog.isSafeToDose("Micro", 5);
    expect(safe).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Cooldown active"),
    );
  });

  test("bypasses cooldown after enough time", async () => {
    const lastDose = { timestamp: new Date(Date.now() - 40000) };
    prisma.watchdogConfig.findUnique.mockResolvedValue({
      enabled: true,
      cooldownSecs: 30,
    });
    prisma.doseLog.findFirst.mockResolvedValue(lastDose);
    prisma.doseLog.aggregate.mockResolvedValue({ _sum: { ml: 0 } });
    const safe = await Watchdog.isSafeToDose("Gro", 10);
    expect(safe).toBe(true);
  });

  test("enforces daily limit for non‑water", async () => {
    prisma.watchdogConfig.findUnique.mockResolvedValue({
      enabled: true,
      dailyLimitMl: 100,
    });
    prisma.doseLog.aggregate.mockResolvedValue({ _sum: { ml: 95 } });
    prisma.doseLog.findFirst.mockResolvedValue(null);
    const safe = await Watchdog.isSafeToDose("Bloom", 10);
    expect(safe).toBe(false);
  });

  test("bypasses daily limit for water", async () => {
    prisma.watchdogConfig.findUnique.mockResolvedValue({
      enabled: true,
      dailyLimitMl: 100,
    });
    // aggregate is not called for water, so no need to mock, but still safe
    const safe = await Watchdog.isSafeToDose("Water", 5000);
    expect(safe).toBe(true);
  });

  test("logs successful dose", async () => {
    await Watchdog.logSuccessfulDose("CalMag", 12.5);
    expect(prisma.doseLog.create).toHaveBeenCalledWith({
      data: { pumpName: "CalMag", ml: 12.5, status: "SUCCESS" },
    });
  });

  test("water is safe even if config missing (default created)", async () => {
    prisma.watchdogConfig.findUnique.mockResolvedValue(null);
    prisma.watchdogConfig.create.mockResolvedValue({
      enabled: true,
      dailyLimitMl: 20000,
    });
    prisma.doseLog.aggregate.mockResolvedValue({ _sum: { ml: 0 } });
    const safe = await Watchdog.isSafeToDose("Water", 5000);
    expect(safe).toBe(true);
  });

  test("water does not create config and is always safe", async () => {
    prisma.watchdogConfig.findUnique.mockResolvedValue(null);
    const safe = await Watchdog.isSafeToDose("Water", 5000);
    expect(safe).toBe(true);
    expect(prisma.watchdogConfig.create).not.toHaveBeenCalled();
  });
});
