const RecipeEngine = require("../../../../src/services/recipeEngine");
const Watchdog = require("../../../../src/services/watchdog");
const MockMqttService = require("../../../mocks/mockMqttService");
const fs = require("fs");

jest.mock("../../../../src/services/watchdog", () => ({
  isSafeToDose: jest.fn().mockResolvedValue(true),
  logSuccessfulDose: jest.fn(),
}));

jest.mock("fs", () => ({
  promises: {
    readFile: jest.fn().mockImplementation((path) => {
      if (path.includes("hardware.json")) {
        return Promise.resolve(
          JSON.stringify({
            peristaltic_ml_per_sec: 200.0,
            carrier_water_ml_per_sec: 50.0,
            delivery_pump_ml_per_sec: 50.0,
            safety_buffer_ms: 30000,
          }),
        );
      }
      return Promise.reject(new Error("unexpected path"));
    }),
  },
}));

describe("RecipeEngine.executePumpAndWait", () => {
  let engine;
  let mqtt;

  beforeEach(() => {
    mqtt = new MockMqttService();
    engine = new RecipeEngine(mqtt);
    jest.spyOn(engine, "waitForDoseComplete").mockImplementation(() =>
      Promise.resolve({
        type: "complete",
        volume: mqtt.activeCommand?.ml || 0,
      }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  test("returns 0 if amount <= 0.5", async () => {
    const result = await engine.executePumpAndWait(
      "Water",
      "dose_water",
      0.3,
      expect.objectContaining({ potId: "A" }),
    );
    expect(result).toBe(0);
    expect(mqtt.sendCommand).not.toHaveBeenCalled();
  });

  test("caps non‑water at 15 ml", async () => {
    const result = await engine.executePumpAndWait(
      "CalMag",
      "dose_calmag",
      100,
      expect.objectContaining({ potId: "A" }),
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
    const result = await engine.executePumpAndWait(
      "Water",
      "dose_water",
      1000,
      expect.any(String),
    );
    expect(result).toBe(1000);
    expect(Watchdog.logSuccessfulDose).toHaveBeenCalledWith(
      "Water",
      1000,
      expect.any(String),
    );
  });

  test("retries on OFFLINE_INTERRUPT and resumes", async () => {
    mqtt.waitForBusy.mockRejectedValueOnce(new Error("OFFLINE_INTERRUPT"));
    mqtt.waitForBusy.mockResolvedValueOnce();
    const result = await engine.executePumpAndWait(
      "Water",
      "dose_water",
      1000,
      expect.objectContaining({ potId: "A" }),
    );
    expect(result).toBe(1000);
    expect(mqtt.waitForBusy).toHaveBeenCalledTimes(2);
  });

  test("throws error after MAX_RETRIES exceeded", async () => {
    jest.spyOn(engine, "waitForDoseComplete").mockResolvedValue(null);
    mqtt.waitForBusy.mockRejectedValue(new Error("OFFLINE_INTERRUPT"));
    const promise = engine.executePumpAndWait(
      "Water",
      "dose_water",
      1000,
      expect.objectContaining({ potId: "A" }),
    );
    await expect(promise).rejects.toThrow(
      "Failed to dose Water after 3 retries",
    );
  });

  test("handles partial completion and sends second command", async () => {
    mqtt.waitForBusy.mockResolvedValue();
    jest
      .spyOn(engine, "waitForDoseComplete")
      .mockResolvedValue({ type: "complete", volume: 600 });
    const result = await engine.executePumpAndWait(
      "Water",
      "dose_water",
      1000,
      expect.objectContaining({ potId: "A" }),
    );
    // Should have sent a second command for the remaining 400
    expect(mqtt.sendCommand).toHaveBeenCalledTimes(2);
    expect(mqtt.sendCommand).toHaveBeenNthCalledWith(
      2,
      "dose_water",
      400,
      "None",
      2,
    );
    expect(result).toBe(1000);
  });

  test("loads hardware config on first use", async () => {
    // Ensure the engine hasn't loaded config yet
    expect(engine.peristalticFlowMlPerSec).toBeNull();
    // Call a method that triggers _ensureHardwareConfig
    await engine.executePumpAndWait(
      "Water",
      "dose_water",
      10,
      expect.objectContaining({ potId: "A" }),
    );
    expect(engine.peristalticFlowMlPerSec).toBe(200.0);
    expect(engine.submersibleFlowMlPerSec).toBe(50.0);
  });

  test("_ensureHardwareConfig returns early if already loaded", async () => {
    // 🟩 fs.promises is now correct because we imported 'fs' as a module
    fs.promises.readFile.mockClear();

    await engine._ensureHardwareConfig();
    await engine._ensureHardwareConfig();

    expect(fs.promises.readFile).toHaveBeenCalledTimes(1);
  });

  test("executePumpAndWait recovery handles busy fallback to idle", async () => {
    // Force a disconnect error to enter the recovery block
    mqtt.waitForBusy.mockRejectedValueOnce(new Error("OFFLINE_INTERRUPT"));

    // 🟩 FIXED: Return a perpetually pending promise so it safely loses the Promise.race
    jest
      .spyOn(engine, "waitForDoseComplete")
      .mockReturnValue(new Promise(() => {}));

    mqtt.waitForBusy.mockResolvedValueOnce(); // First recovery check wins the race
    mqtt.waitForIdle.mockResolvedValueOnce(); // Second recovery check wins the race

    const result = await engine.executePumpAndWait("Water", "dose_water", 10, {
      potId: "A",
      maxRetries: 1,
    });

    // 🟩 FIXED: Because it went idle without completing, the engine assumes the
    // remaining volume is 0 to safely break the loop and prevent flooding.
    // Therefore, it resolves returning the requested safeMl (10)
    expect(result).toBe(10);
  });
});
