const {
  _autoSeed,
  _runEngineLoop,
  _hardwareComms,
  _engine,
} = require("../../../src/server");
const { PrismaClient } = require("@prisma/client");
const fs = require("fs").promises;

jest.mock("@prisma/client");
jest.mock("fs", () => ({
  promises: { readFile: jest.fn(), writeFile: jest.fn() },
}));

describe("Server Startup Logic", () => {
  let prisma;

  beforeEach(() => {
    prisma = new PrismaClient();
    jest.clearAllMocks();
    // Silence console logs
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("autoSeed creates missing SystemState", async () => {
    prisma.systemState.findUnique.mockResolvedValue(null);
    prisma.systemState.create.mockResolvedValue({ id: 1, currentDay: 1 });
    prisma.watchdogConfig.findUnique.mockResolvedValue(null);
    prisma.watchdogConfig.create.mockResolvedValue({});
    fs.readFile.mockResolvedValue(
      JSON.stringify({ watchdog: { defaultCooldownSecs: 30 } }),
    );

    const state = await _autoSeed();

    expect(prisma.systemState.create).toHaveBeenCalled();
    expect(prisma.watchdogConfig.create).toHaveBeenCalledTimes(8); // 8 required pumps
    expect(state.currentDay).toBe(1);
  });

  test("autoSeed does nothing if SystemState already exists", async () => {
    prisma.systemState.findUnique.mockResolvedValue({ id: 1, currentDay: 50 });
    prisma.watchdogConfig.findUnique.mockResolvedValue({ pumpName: "pH_Down" }); // exists

    await _autoSeed();

    expect(prisma.systemState.create).not.toHaveBeenCalled();
    expect(prisma.watchdogConfig.create).not.toHaveBeenCalled();
  });

  test("runEngineLoop executes engine tick and reschedules", async () => {
    jest.useFakeTimers();
    const tickSpy = jest.spyOn(_engine, "executeTick").mockResolvedValue();

    const loopPromise = _runEngineLoop(); // this will call tick and then setTimeout
    // Wait for first tick
    await Promise.resolve();
    expect(tickSpy).toHaveBeenCalledTimes(1);

    // Advance timer to trigger next tick
    jest.advanceTimersByTime(5 * 60 * 1000);
    await Promise.resolve();
    expect(tickSpy).toHaveBeenCalledTimes(2);

    tickSpy.mockRestore();
    jest.useRealTimers();
  });

  test("first telemetry triggers engine tick", () => {
    const tickSpy = jest.spyOn(_engine, "executeTick").mockResolvedValue();
    // Simulate the 'telemetry' event that the hardwareComms emits
    _hardwareComms.emit("telemetry", {});
    expect(tickSpy).toHaveBeenCalledTimes(1);
    tickSpy.mockRestore();
  });
});
