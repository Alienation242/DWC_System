const RecipeEngine = require("../../../../src/services/recipeEngine");
const Watchdog = require("../../../../src/services/watchdog");
const MockMqttService = require("../../../mocks/mockMqttService");
const fs = require("fs").promises;

jest.mock("../../../../src/services/watchdog", () => ({
  isSafeToDose: jest.fn().mockResolvedValue(true),
  logSuccessfulDose: jest.fn(),
}));

describe("RecipeEngine - Edge Cases & Uncovered Branches", () => {
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
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("_calculateDilutionMl caps at maxBatchMl when targetPPM <= 0", () => {
    // Expose private method for testing (or test via public method)
    const result = engine._calculateDilutionMl(18, 1000, 0, 5000);
    expect(result).toBe(Math.min(18 * 1000, 5000)); // 5000
  });

  test("_isPpHErrorSignificant returns false when error inside deadband", () => {
    // TARGET_PH = 5.8, deadband = 0.2
    expect(engine._isPpHErrorSignificant(5.99, 0.2)).toBe(false); // error = 0.19
    expect(engine._isPpHErrorSignificant(6.01, 0.2)).toBe(true); // error = 0.21
  });
  test("_calculatePHDoseMl clamps between 1.0 and 5.0", () => {
    expect(engine._calculatePHDoseMl(0.05)).toBe(1.0);
    expect(engine._calculatePHDoseMl(0.5)).toBe(2.5);
    expect(engine._calculatePHDoseMl(1.5)).toBe(5.0);
  });

  test("_loadTickConfigs uses fallback when system.json missing", async () => {
    // Mock fs.readFile to reject for SYSTEM_CONFIG_PATH only
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
    expect(result.maxBatchMl).toBe(5000); // default
    expect(result.strainProfile).toBeDefined();
    expect(result.nutrientConfig).toBeDefined();
    fs.readFile = originalReadFile;
  });

  test("_handleEcExcess returns false when dilutionMl <= 50", async () => {
    const spy = jest.spyOn(engine, "executePumpAndWait");
    const result = await engine._handleEcExcess(500, 490, 1, 5000);
    // sysVol=1, live=500, target=490 → dilution = 1000*(500/490-1) ≈ 20.4 ml → <=50 → no pump
    expect(spy).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  test("_handleEcDeficit returns false when totalNeeded <= 1.0", async () => {
    // Mock calculateDeficit to return very small values
    jest.spyOn(engine, "calculateDeficit").mockReturnValue({
      cal: 0.1,
      gro: 0.1,
      micro: 0.1,
      bloom: 0.1,
      fin: 0.1,
    });
    const spy = jest.spyOn(engine, "executePumpAndWait");
    const result = await engine._handleEcDeficit(
      400,
      410,
      "VEGETATIVE",
      50,
      18,
      { carrierVolumeMl: 500 },
      5000,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  test("_handlePhCorrection returns false when watchdog blocks", async () => {
    Watchdog.isSafeToDose.mockResolvedValueOnce(false);
    const spy = jest.spyOn(engine, "executePumpAndWait");
    const result = await engine._handlePhCorrection(7.2);
    expect(spy).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  test("executeTick sends stop command on error", async () => {
    // Mock telemetry and systemState to exist
    const mockTelemetry = {
      realEC: 800,
      realPH: 5.8,
      isTankEmpty: false,
      isTankOverflowing: false,
    };
    const mockSystemState = {
      currentDay: 50,
      sysVol: 18,
      currentProfilePath: null,
    };

    // Setup prisma mocks (global mockPrisma is available)
    mockPrisma.telemetryLog.findFirst.mockResolvedValue(mockTelemetry);
    mockPrisma.systemState.findFirst.mockResolvedValue(mockSystemState);

    // Now mock _loadTickConfigs to throw
    jest
      .spyOn(engine, "_loadTickConfigs")
      .mockRejectedValue(new Error("DB failure"));

    const stopSpy = jest.spyOn(engine.mqtt, "sendCommand");
    await engine.executeTick();

    expect(stopSpy).toHaveBeenCalledWith("stop", 0, "None", expect.any(Number));
    expect(engine.isTicking).toBe(false);
  });

  test("_handleEcExcess returns false if executePumpAndWait returns 0", async () => {
    jest.spyOn(engine, "executePumpAndWait").mockResolvedValue(0);
    const spyDeliver = jest.spyOn(engine, "_deliverToPot");
    const result = await engine._handleEcExcess(600, 500, 18, 5000);
    expect(result).toBe(false);
    expect(spyDeliver).not.toHaveBeenCalled();
  });

  test("_handleEcDeficit skips nutrients with amount <= 0.5", async () => {
    const mockDose = {
      cal: 0.4,
      micro: 5.0,
      gro: 0.3,
      bloom: 2.0,
      fin: 0,
    };
    jest.spyOn(engine, "calculateDeficit").mockReturnValue(mockDose);
    const executeSpy = jest
      .spyOn(engine, "executePumpAndWait")
      .mockResolvedValue(1);
    const nutrientConfig = {
      carrierFluid: "Water",
      carrierVolumeMl: 500,
      mixingSequence: ["CalMag", "Micro", "Gro", "Bloom"],
    };
    await engine._handleEcDeficit(
      400,
      500,
      "VEGETATIVE",
      50,
      18,
      nutrientConfig,
      5000,
    );
    // Only Micro and Bloom should be called (amount > 0.5)
    expect(executeSpy).toHaveBeenCalledWith(
      "Micro",
      "dose_micro",
      expect.any(Number),
      expect.objectContaining({ potId: "A" }),
    );
    expect(executeSpy).toHaveBeenCalledWith(
      "Bloom",
      "dose_bloom",
      expect.any(Number),
      expect.objectContaining({ potId: "A" }),
    );
    expect(executeSpy).not.toHaveBeenCalledWith(
      "CalMag",
      "dose_calmag",
      expect.any(Number),
      expect.objectContaining({ potId: "A" }),
    );
    expect(executeSpy).not.toHaveBeenCalledWith(
      "Gro",
      "dose_gro_fin_relay",
      expect.any(Number),
      expect.objectContaining({ potId: "A" }),
    );
  });

  test("waitForDoseComplete rejects on timeout", async () => {
    const seq = 123;
    const promise = engine.waitForDoseComplete(seq, 50);
    await expect(promise).rejects.toThrow("DOSE_COMPLETE_TIMEOUT");
  });

  test("_deliverToPot does nothing when volume <= 0.5", async () => {
    const spy = jest.spyOn(mqtt, "sendCommand");
    await engine._deliverToPot(0.3);
    expect(spy).not.toHaveBeenCalled();
  });

  test("_deliverToPot handles offline interrupt with deduction", async () => {
    // Force waitForIdle to throw OFFLINE_INTERRUPT after a short delay
    mqtt.waitForIdle.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 50));
      throw new Error("OFFLINE_INTERRUPT");
    });
    // After the interrupt, the loop will retry. waitForIdle will succeed on second call
    mqtt.waitForIdle.mockResolvedValueOnce(); // second call resolves
    const spySend = jest.spyOn(mqtt, "sendCommand");
    await engine._deliverToPot(100);
    // It should call sendCommand twice: first time, then after deduction it still has volume >0.5, so second call
    expect(spySend).toHaveBeenCalledTimes(2);
  });

  test("executePumpAndWait – idle instead of complete (result.type === 'idle')", async () => {
    // Override waitForIdle to resolve after a short delay (simulate idle)
    mqtt.waitForIdle.mockResolvedValue();
    // Do NOT simulate hardware complete
    const promise = engine.executePumpAndWait("Water", "dose_water", 100, {
      retryDelayMs: 10,
      waitForBusyTimeoutMs: 100,
    });
    await new Promise((r) => setTimeout(r, 50));
    // waitForDoseComplete will never complete, waitForIdle will resolve first
    const result = await promise;
    // It should return the dosed amount (0 because idle happened before completion? Actually logic sets remainingMl=0 and breaks)
    expect(result).toBe(100);
  });

  test("executePumpAndWait – non‑OFFLINE_INTERRUPT error propagates", async () => {
    mqtt.waitForBusy.mockRejectedValue(new Error("RANDOM_ERROR"));
    await expect(
      engine.executePumpAndWait("Water", "dose_water", 100),
    ).rejects.toThrow("RANDOM_ERROR");
  });

  test("executePumpAndWait – waitForDevice timeout triggers retry and exhaustion", async () => {
    mqtt.waitForDevice.mockRejectedValue(new Error("TIMEOUT"));
    const promise = engine.executePumpAndWait("Water", "dose_water", 100, {
      maxRetries: 1,
      retryDelayMs: 10,
    });
    await expect(promise).rejects.toThrow(
      /Failed to dose Water after 1 retries/,
    );
  });

  test("executePumpAndWait – waitForDevice timeout triggers multiple retries and exhaustion", async () => {
    mqtt.waitForDevice.mockRejectedValue(new Error("TIMEOUT"));
    const promise = engine.executePumpAndWait("Water", "dose_water", 100, {
      maxRetries: 2,
      retryDelayMs: 10,
    });
    await expect(promise).rejects.toThrow(
      /Failed to dose Water after 2 retries/,
    );
  });

  test("_loadTickConfigs catch block when system.json read fails", async () => {
    const originalReadFile = fs.readFile;
    // Override readFile to reject for system.json, but succeed for others
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
    // The catch block sets maxBatchMl to default 5000
    expect(result.maxBatchMl).toBe(5000);
    fs.readFile = originalReadFile;
  });

  // Ensure _handleEcExcess dilutionMl <= 50 branch (lines 286-288) is covered
  test("_handleEcExcess returns false when dilutionMl exactly 50", async () => {
    // sysVol = 0.1, livePPM=1000, targetPPM=500 -> dilution = 0.1*1000*(2-1)=100ml, but maxBatchMl=50 clamps to 50.
    const result = await engine._handleEcExcess(1000, 500, 0.1, 50);
    expect(result).toBe(false);
    // Also test exactly 0 dilution
    const result2 = await engine._handleEcExcess(500, 500, 18, 5000);
    expect(result2).toBe(false);
  });

  // Ensure _handleEcDeficit totalNeeded <= 1.0 branch (line 433) is covered with different values
  test("_handleEcDeficit returns false when totalNeeded = 0.5", async () => {
    jest.spyOn(engine, "calculateDeficit").mockReturnValue({
      cal: 0.2,
      gro: 0.1,
      micro: 0.1,
      bloom: 0.1,
      fin: 0,
    });
    const spy = jest.spyOn(engine, "executePumpAndWait");
    const result = await engine._handleEcDeficit(
      400,
      410,
      "VEGETATIVE",
      50,
      18,
      { carrierVolumeMl: 500 },
      5000,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  // Ensure _handlePhCorrection watchdog blocked branch (lines 544-545) is covered
  test("_handlePhCorrection watchdog blocked returns false", async () => {
    Watchdog.isSafeToDose.mockResolvedValueOnce(false);
    const result = await engine._handlePhCorrection(7.2);
    expect(result).toBe(false);
  });

  // Ensure executeTick catch block (lines 633-637, 640-641) is covered by forcing an error after telemetry and systemState exist
  test("executeTick catch block handles error and sends stop command", async () => {
    // Setup mocks to make executeTick proceed past early returns
    const mockTelemetry = {
      realEC: 800,
      realPH: 5.8,
      isTankEmpty: false,
      isTankOverflowing: false,
    };
    const mockSystemState = {
      currentDay: 50,
      sysVol: 18,
      currentProfilePath: null,
    };

    mockPrisma.telemetryLog.findFirst.mockResolvedValue(mockTelemetry);
    mockPrisma.systemState.findFirst.mockResolvedValue(mockSystemState);

    // Force an error inside the try block (after _loadTickConfigs succeeds, but before returning)
    // For example, mock getDynamicTarget to throw
    jest.spyOn(engine, "getDynamicTarget").mockImplementation(() => {
      throw new Error("Dynamic target error");
    });

    const stopSpy = jest.spyOn(engine.mqtt, "sendCommand");
    await engine.executeTick();

    expect(stopSpy).toHaveBeenCalledWith("stop", 0, "None", expect.any(Number));
    expect(engine.isTicking).toBe(false);
  });
});
