const RecipeEngine = require("../../../../src/services/recipeEngine");
const MockMqttService = require("../../../mocks/mockMqttService");
const fs = require("fs").promises;
const { mockPrisma } = global;

// Mock Watchdog exactly like other test files
jest.mock("../../../../src/services/watchdog", () => ({
  isSafeToDose: jest.fn().mockResolvedValue(true),
  logSuccessfulDose: jest.fn(),
}));

describe("RecipeEngine - Remaining Coverage", () => {
  let engine;
  let mqtt;

  beforeEach(() => {
    mqtt = new MockMqttService();
    engine = new RecipeEngine(mqtt);
    jest.spyOn(console, "log").mockImplementation();
    jest.spyOn(console, "warn").mockImplementation();
    jest.spyOn(console, "error").mockImplementation();
    // Spy on executePumpAndWait to track calls
    jest.spyOn(engine, "executePumpAndWait").mockResolvedValue(100);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------- Line 137: system.json read failure ----------
  test("_loadTickConfigs uses default maxBatchMl when system.json read fails", async () => {
    const originalReadFile = fs.readFile;
    fs.readFile = jest.fn(async (path) => {
      if (path.includes("system.json")) throw new Error("ENOENT");
      if (path.includes("nutrient_profile.json"))
        return JSON.stringify({ carrierVolumeMl: 500 });
      if (path.includes("default.json"))
        return JSON.stringify({ name: "test" });
      return originalReadFile(path);
    });

    const systemState = { currentProfilePath: null };
    const result = await engine._loadTickConfigs(systemState);
    expect(result.maxBatchMl).toBe(5000); // default from catch
    fs.readFile = originalReadFile;
  });

  // ---------- Lines 286-288: dilutionMl <= 50 ----------
  test("_handleEcExcess returns false when dilutionMl <= 50", async () => {
    // sysVol=0.1, live=500, target=490 -> dilution ~20ml
    const result = await engine._handleEcExcess(500, 490, 0.1, 5000);
    expect(result).toBe(false);
    expect(engine.executePumpAndWait).not.toHaveBeenCalled();
  });

  // ---------- Line 433: totalNeeded <= 1.0 ----------
  test("_handleEcDeficit returns false when totalNeeded <= 1.0", async () => {
    jest.spyOn(engine, "calculateDeficit").mockReturnValue({
      cal: 0.2,
      gro: 0.2,
      micro: 0.2,
      bloom: 0.2,
      fin: 0.2,
    });
    const nutrientConfig = { carrierVolumeMl: 500, mixingSequence: [] };
    const result = await engine._handleEcDeficit(
      400,
      410,
      "VEGETATIVE",
      50,
      18,
      nutrientConfig,
      5000,
    );
    expect(result).toBe(false);
    expect(engine.executePumpAndWait).not.toHaveBeenCalled();
  });

  // ---------- Lines 538,544-545: Watchdog blocks pH correction ----------
  test("_handlePhCorrection returns false when watchdog blocks", async () => {
    const Watchdog = require("../../../../src/services/watchdog");
    Watchdog.isSafeToDose.mockResolvedValueOnce(false);
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation();

    const result = await engine._handlePhCorrection(7.2);
    expect(result).toBe(false);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("pH correction blocked by watchdog"),
    );
    expect(engine.executePumpAndWait).not.toHaveBeenCalled();
    consoleLogSpy.mockRestore();
  });

  // ---------- Lines 633-637,640-641: executeTick catch block ----------
  test("executeTick sends stop command on error", async () => {
    mockPrisma.telemetryLog.findFirst.mockResolvedValue({
      realEC: 800,
      realPH: 5.8,
      isTankEmpty: false,
      isTankOverflowing: false,
    });
    mockPrisma.systemState.findFirst.mockResolvedValue({
      currentDay: 50,
      sysVol: 18,
      currentProfilePath: null,
    });
    jest
      .spyOn(engine, "_loadTickConfigs")
      .mockRejectedValue(new Error("Simulated error"));

    const stopSpy = jest.spyOn(engine.mqtt, "sendCommand");
    await engine.executeTick();

    expect(stopSpy).toHaveBeenCalledWith("stop", 0, "None", expect.any(Number));
    expect(engine.isTicking).toBe(false);
    stopSpy.mockRestore();
  });
});
