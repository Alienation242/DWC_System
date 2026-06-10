const RecipeEngine = require("../../../../src/services/recipeEngine");
const Watchdog = require("../../../../src/services/watchdog");
const MockMqttService = require("../../../mocks/mockMqttService");

jest.mock("../../../../src/services/watchdog", () => ({
  isSafeToDose: jest.fn().mockResolvedValue(true),
  logSuccessfulDose: jest.fn(),
}));

describe("RecipeEngine.executePumpAndWait", () => {
  let engine;
  let mqtt;

  beforeEach(() => {
    jest.useFakeTimers();
    mqtt = new MockMqttService();
    engine = new RecipeEngine(mqtt);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("returns 0 if amount <= 0.5", async () => {
    const result = await engine.executePumpAndWait("Water", "dose_water", 0.3);
    expect(result).toBe(0);
    expect(mqtt.sendCommand).not.toHaveBeenCalled();
  });

  test("caps non‑water at 15 ml", async () => {
    const promise = engine.executePumpAndWait("CalMag", "dose_calmag", 100);
    // Simulate the dose complete
    mqtt.emitDoseComplete(1, 15);
    const result = await promise;
    expect(result).toBe(15);
    expect(mqtt.sendCommand).toHaveBeenCalledWith(
      "dose_calmag",
      15,
      "None",
      expect.any(Number),
    );
  });

  test("successful dose completes", async () => {
    const promise = engine.executePumpAndWait("Water", "dose_water", 1000);
    mqtt.emitDoseComplete(1, 1000);
    const result = await promise;
    expect(result).toBe(1000);
    expect(Watchdog.logSuccessfulDose).toHaveBeenCalledWith("Water", 1000);
  });

  test("retries on OFFLINE_INTERRUPT and resumes", async () => {
    // First waitForBusy throws, then second resolves
    mqtt.waitForBusy.mockRejectedValueOnce(new Error("OFFLINE_INTERRUPT"));
    mqtt.waitForBusy.mockResolvedValueOnce();
    const promise = engine.executePumpAndWait("Water", "dose_water", 1000);
    // Simulate that after reconnect we emit complete
    setImmediate(() => mqtt.emitDoseComplete(1, 1000));
    const result = await promise;
    expect(result).toBe(1000);
    expect(mqtt.waitForBusy).toHaveBeenCalledTimes(2);
  });
});
