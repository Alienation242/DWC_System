const RecipeEngine = require("../../../../src/services/recipeEngine");
const MockMqttService = require("../../../mocks/mockMqttService");
const fs = require("fs").promises;
const { mockPrisma } = global;

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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("_loadTickConfigs uses default maxBatchMl when system.json read fails (line 137)", async () => {
    const spy = jest.spyOn(fs, "readFile");
    // First call for strain profile, second for nutrient, third for system (fail)
    spy.mockImplementation((path) => {
      if (path.includes("system.json"))
        return Promise.reject(new Error("ENOENT"));
      if (path.includes("nutrient_profile.json"))
        return Promise.resolve(JSON.stringify({ carrierVolumeMl: 500 }));
      if (path.includes("default.json"))
        return Promise.resolve(JSON.stringify({ name: "test", flipWeek: 6 }));
      return Promise.reject(new Error("unexpected"));
    });
    const systemState = { currentProfilePath: null };
    const result = await engine._loadTickConfigs(systemState);
    expect(result.maxBatchMl).toBe(5000);
    spy.mockRestore();
  });

  test("_handleEcExcess returns false when dilutionMl <= 50 (lines 286-288)", async () => {
    const result = await engine._handleEcExcess(500, 490, 0.1, 5000);
    expect(result).toBe(false);
  });

  test("_handleEcDeficit returns false when totalNeeded <= 1.0 (line 433)", async () => {
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
  });

  test("_handlePhCorrection returns false when watchdog blocks (lines 538,544-545)", async () => {
    const Watchdog = require("../../../../src/services/watchdog");
    Watchdog.isSafeToDose.mockResolvedValueOnce(false);
    const result = await engine._handlePhCorrection(7.2);
    expect(result).toBe(false);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("pH correction blocked by watchdog"),
    );
  });

  test("executeTick sends stop command on error (lines 633-637,640-641)", async () => {
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
  });

  test("_handleEcExcess dilutionMl exactly 0 also returns false", async () => {
    const result = await engine._handleEcExcess(500, 500, 18, 5000);
    expect(result).toBe(false);
  });
});
