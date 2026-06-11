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
    jest.restoreAllMocks();
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
    // First waitForDevice succeeds, then we never call it again (loop will break)
    const spySend = jest.spyOn(mqtt, "sendCommand");
    await engine._deliverToPot(100);
    // Should have called sendCommand once, then after interrupt, remaining becomes <0.5 (deducted)
    expect(spySend).toHaveBeenCalledTimes(1);
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
});
