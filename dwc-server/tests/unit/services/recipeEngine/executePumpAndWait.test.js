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
    mqtt = new MockMqttService();
    engine = new RecipeEngine(mqtt);
    // Spy on waitForDoseComplete to resolve immediately
    jest
      .spyOn(engine, "waitForDoseComplete")
      .mockImplementation((seq, timeout) => {
        return Promise.resolve({
          type: "complete",
          volume: mqtt.activeCommand?.ml || 0,
        });
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns 0 if amount <= 0.5", async () => {
    const result = await engine.executePumpAndWait("Water", "dose_water", 0.3);
    expect(result).toBe(0);
    expect(mqtt.sendCommand).not.toHaveBeenCalled();
  });

  test("caps non‑water at 15 ml", async () => {
    const result = await engine.executePumpAndWait(
      "CalMag",
      "dose_calmag",
      100,
    );
    expect(result).toBe(15);
    expect(mqtt.sendCommand).toHaveBeenCalledWith(
      "dose_calmag",
      15,
      "None",
      expect.any(Number),
    );
  });

  test("successful dose completes", async () => {
    const result = await engine.executePumpAndWait("Water", "dose_water", 1000);
    expect(result).toBe(1000);
    expect(Watchdog.logSuccessfulDose).toHaveBeenCalledWith("Water", 1000);
  });

  test("retries on OFFLINE_INTERRUPT and resumes", async () => {
    mqtt.waitForBusy.mockRejectedValueOnce(new Error("OFFLINE_INTERRUPT"));
    mqtt.waitForBusy.mockResolvedValueOnce();
    const result = await engine.executePumpAndWait("Water", "dose_water", 1000);
    expect(result).toBe(1000);
    expect(mqtt.waitForBusy).toHaveBeenCalledTimes(2);
  });
});
