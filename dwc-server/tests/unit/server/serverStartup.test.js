const { mockPrisma } = global;

jest.mock("fs", () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

const fs = require("fs");
const {
  _autoSeed,
  _runEngineLoop,
  _engine,
  _hardwareComms,
} = require("../../../src/server");

const mockEngine = { executeTick: jest.fn().mockResolvedValue() };
const mockHardwareComms = { emit: jest.fn() };

const engine = _engine || mockEngine;
const hardwareComms = _hardwareComms || mockHardwareComms;

describe("Server Startup Logic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test("autoSeed creates missing SystemState", async () => {
    fs.promises.readFile.mockResolvedValue('{"watchdog": {}}');
    mockPrisma.systemState.findUnique.mockResolvedValue(null);
    mockPrisma.systemState.create.mockResolvedValue({ id: 1, currentDay: 1 });

    const state = await _autoSeed();

    expect(mockPrisma.systemState.create).toHaveBeenCalled();
    expect(state.currentDay).toBe(1);
  });

  test("autoSeed does nothing if SystemState already exists", async () => {
    fs.promises.readFile.mockResolvedValue('{"watchdog": {}}');
    mockPrisma.systemState.findUnique.mockResolvedValue({
      id: 1,
      currentDay: 50,
    });

    const state = await _autoSeed();

    expect(mockPrisma.systemState.create).not.toHaveBeenCalled();
    expect(state.currentDay).toBe(50);
  });

  test("runEngineLoop executes engine tick and reschedules", async () => {
    jest.useFakeTimers();
    const tickSpy = jest.spyOn(engine, "executeTick").mockResolvedValue();
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");

    _runEngineLoop();
    await Promise.resolve();

    expect(tickSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      5 * 60 * 1000,
    );
  });

  test("first telemetry triggers engine tick", () => {
    const tickSpy = jest.spyOn(engine, "executeTick").mockResolvedValue();
    hardwareComms.emit("telemetry", {});
    expect(tickSpy).toHaveBeenCalledTimes(1);
  });

  test("autoSeed handles missing system.json gracefully (triggers catch block)", async () => {
    fs.promises.readFile.mockRejectedValueOnce(new Error("ENOENT"));

    mockPrisma.systemState.findUnique.mockResolvedValue({
      id: 1,
      currentDay: 1,
    });

    await _autoSeed();

    expect(console.warn).toHaveBeenCalledWith(
      "⚠️ Could not load system.json, using default watchdog limits",
    );
  });

  test("autoSeed does not create watchdog configs in test environment", async () => {
    fs.promises.readFile.mockResolvedValue('{"watchdog": {}}');
    const prisma = require("@prisma/client").PrismaClient();
    const createSpy = jest.spyOn(prisma.watchdogConfig, "create");

    await _autoSeed();

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("autoSeed creates watchdog configs when not in test environment", async () => {
    fs.promises.readFile.mockResolvedValue('{"watchdog": {}}');
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    mockPrisma.systemState.findUnique.mockResolvedValue({
      id: 1,
      currentDay: 50,
    });
    mockPrisma.watchdogConfig.findUnique.mockResolvedValue(null);
    mockPrisma.watchdogConfig.create.mockResolvedValue({});

    await _autoSeed();

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
    process.env.NODE_ENV = originalEnv;
  });

  test("exports Express app directly when NODE_ENV is not test", () => {
    jest.isolateModules(() => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const serverModule = require("../../../src/server");

      expect(typeof serverModule).toBe("function");

      process.env.NODE_ENV = originalEnv;
    });
  });
});
