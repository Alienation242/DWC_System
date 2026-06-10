const { _autoSeed } = require("../../../src/server");
const { mockPrisma } = global;
const fs = require("fs").promises;

describe("Server Startup Logic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

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
    const loopPromise = _runEngineLoop();
    await Promise.resolve(); // let first tick start
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
    // Simulate the 'telemetry' event on hardwareComms
    _hardwareComms.emit("telemetry", {});
    expect(tickSpy).toHaveBeenCalledTimes(1);
    tickSpy.mockRestore();
  });
});
