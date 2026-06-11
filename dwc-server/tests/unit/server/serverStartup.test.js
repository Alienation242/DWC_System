const { _autoSeed } = require("../../../src/server");
const { mockPrisma } = global;
const fs = require("fs").promises;

describe("Server Startup Logic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => jest.useRealTimers());

  test("autoSeed creates missing SystemState", async () => {
    mockPrisma.systemState.findUnique.mockResolvedValue(null);
    mockPrisma.systemState.create.mockResolvedValue({ id: 1, currentDay: 1 });
    const state = await _autoSeed();
    expect(mockPrisma.systemState.create).toHaveBeenCalled();
    expect(state.currentDay).toBe(1);
  });

  test("autoSeed does nothing if SystemState already exists", async () => {
    mockPrisma.systemState.findUnique.mockResolvedValue({
      id: 1,
      currentDay: 50,
    });
    const state = await _autoSeed();
    expect(mockPrisma.systemState.create).not.toHaveBeenCalled();
    expect(state.currentDay).toBe(50);
  });

  const {
    _runEngineLoop,
    _engine,
    _hardwareComms,
  } = require("../../../src/server");

  test("runEngineLoop executes engine tick and reschedules", async () => {
    jest.useFakeTimers();
    const tickSpy = jest.spyOn(_engine, "executeTick").mockResolvedValue();
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");
    _runEngineLoop();
    await Promise.resolve();
    expect(tickSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      5 * 60 * 1000,
    );
    tickSpy.mockRestore();
    setTimeoutSpy.mockRestore();
    jest.useRealTimers();
  });

  test("first telemetry triggers engine tick", () => {
    const tickSpy = jest.spyOn(_engine, "executeTick").mockResolvedValue();
    _hardwareComms.emit("telemetry", {});
    expect(tickSpy).toHaveBeenCalledTimes(1);
    tickSpy.mockRestore();
  });

  test("autoSeed handles missing system.json gracefully", async () => {
    fs.readFile.mockRejectedValueOnce(new Error("ENOENT"));
    const state = await _autoSeed();
    expect(state).toBeDefined();
  });

  test("autoSeed does not create watchdog configs in test environment", async () => {
    const prisma = require("@prisma/client").PrismaClient();
    const createSpy = jest.spyOn(prisma.watchdogConfig, "create");
    await _autoSeed();
    expect(createSpy).not.toHaveBeenCalled();
  });

  // Fixed: This test now correctly covers lines 243-268
  test("autoSeed creates watchdog configs when not in test environment", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    mockPrisma.systemState.findUnique.mockResolvedValue({
      id: 1,
      currentDay: 50,
    });
    mockPrisma.watchdogConfig.findUnique.mockResolvedValue(null);
    mockPrisma.watchdogConfig.create.mockResolvedValue({});

    await _autoSeed();

    // Verify create was called for each required pump
    const requiredPumps = [
      "pH_Down",
      "pH_Up",
      "Micro",
      "Bloom",
      "CalMag",
      "Gro",
      "Finisher",
      "Water",
    ];
    expect(mockPrisma.watchdogConfig.create).toHaveBeenCalledTimes(
      requiredPumps.length,
    );
    for (const pump of requiredPumps) {
      expect(mockPrisma.watchdogConfig.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ pumpName: pump }),
      });
    }
    process.env.NODE_ENV = originalEnv;
  });
});
