const RecipeEngine = require("../../../../src/services/recipeEngine");
const fs = require("fs").promises;
const mockPrisma = require("../../../mocks/mockPrisma");
const MockMqttService = require("../../../mocks/mockMqttService");

// Mock fs
jest.mock("fs", () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
}));

// Mock watchdog
jest.mock("../../../../src/services/watchdog", () => ({
  isSafeToDose: jest.fn().mockResolvedValue(true),
  logSuccessfulDose: jest.fn(),
}));

describe("RecipeEngine.executeTick", () => {
  let engine;
  let mqtt;

  beforeEach(() => {
    jest.clearAllMocks();
    mqtt = new MockMqttService();
    engine = new RecipeEngine(mqtt);
    // Stub executePumpAndWait and _deliverToPot to avoid real dosing
    engine.executePumpAndWait = jest.fn().mockResolvedValue(100);
    engine._deliverToPot = jest.fn().mockResolvedValue();

    // Default strain profile (Standard Hybrid)
    const defaultProfile = {
      name: "Standard Hybrid",
      flipWeek: 9,
      stretchWks: 3,
      bulkWks: 5,
      ripenWks: 2,
      phases: {
        veg: {
          basePpm: { start: 50, end: 500, curve: 1.5 },
          ppfd: { start: 250, end: 550, curve: 1.0 },
          lightMult: { start: 0.5, end: 0.5, curve: 1.0 },
        },
        initiation: {
          basePpm: { start: 500, end: 750, curve: 1.0 },
          ppfd: { start: 650, end: 950, curve: 1.0 },
          lightMult: { start: 0.5, end: 0.5, curve: 1.0 },
        },
        bulking: {
          basePpm: { start: 350, end: 350, curve: 1.0 },
          ppfd: { start: 950, end: 1050, curve: 1.0 },
          lightMult: { start: 0.5, end: 0.5, curve: 1.0 },
        },
        ripening: {
          basePpm: { start: 650, end: 650, curve: 1.0 },
          ppfd: { start: 1050, end: 800, curve: 1.5 },
          lightMult: { start: 0.5, end: 0.5, curve: 1.0 },
        },
      },
    };
    fs.readFile.mockImplementation((path) => {
      if (path.includes("nutrient_profile.json")) {
        return Promise.resolve(
          JSON.stringify({
            carrierFluid: "Water",
            carrierVolumeMl: 500,
            mixingSequence: ["CalMag", "Micro", "Gro", "Bloom"],
          }),
        );
      }
      if (path.includes("system.json")) {
        return Promise.resolve(
          JSON.stringify({ mixing: { maxMixingTankVolumeMl: 5000 } }),
        );
      }
      if (path.includes(".json")) {
        return Promise.resolve(JSON.stringify(defaultProfile));
      }
      return Promise.reject(new Error("no mock"));
    });

    // Default system state
    mockPrisma.systemState.findFirst.mockResolvedValue({
      currentDay: 50,
      sysVol: 18,
    });
    // Default telemetry (pH 5.8, EC 800 → 400 PPM)
    mockPrisma.telemetryLog.findFirst.mockResolvedValue({
      realPH: 5.8,
      realEC: 800,
      timestamp: new Date(),
    });
  });

  test("does nothing if no telemetry", async () => {
    mockPrisma.telemetryLog.findFirst.mockResolvedValue(null);
    await engine.executeTick();
    expect(engine.executePumpAndWait).not.toHaveBeenCalled();
  });

  test("does nothing if EC within deadband", async () => {
    await engine.executeTick();
    expect(engine.executePumpAndWait).not.toHaveBeenCalled();
  });

  test("triggers dilution when EC too high", async () => {
    mockPrisma.telemetryLog.findFirst.mockResolvedValue({
      realPH: 5.8,
      realEC: 1200, // 600 PPM
    });
    jest
      .spyOn(engine, "getDynamicTarget")
      .mockReturnValue({ targetPPM: 400, phase: "VEGETATIVE" });
    await engine.executeTick();
    expect(engine.executePumpAndWait).toHaveBeenCalledWith(
      "Water",
      "dose_water",
      expect.any(Number),
    );
    expect(engine._deliverToPot).toHaveBeenCalled();
    engine.getDynamicTarget.mockRestore();
  });

  test("triggers nutrient dosing when EC too low", async () => {
    mockPrisma.telemetryLog.findFirst.mockResolvedValue({
      realPH: 5.8,
      realEC: 400,
    });
    jest
      .spyOn(engine, "getDynamicTarget")
      .mockReturnValue({ targetPPM: 600, phase: "VEGETATIVE" });
    await engine.executeTick();
    expect(engine.executePumpAndWait).toHaveBeenCalledWith(
      "Water",
      "dose_water",
      expect.any(Number),
    );
    expect(engine.executePumpAndWait).toHaveBeenCalledWith(
      "CalMag",
      "dose_calmag",
      expect.any(Number),
    );
    expect(engine._deliverToPot).toHaveBeenCalled();
    engine.getDynamicTarget.mockRestore();
  });

  test("triggers pH correction when pH is off", async () => {
    mockPrisma.telemetryLog.findFirst.mockResolvedValue({
      realPH: 7.2,
      realEC: 800,
    });
    jest
      .spyOn(engine, "getDynamicTarget")
      .mockReturnValue({ targetPPM: 400, phase: "VEGETATIVE" });
    await engine.executeTick();
    expect(engine.executePumpAndWait).toHaveBeenCalledWith(
      "pH_Down",
      "dose_ph_down",
      expect.any(Number),
    );
    expect(engine.executePumpAndWait).toHaveBeenCalledWith(
      "Water",
      "dose_water",
      250,
    );
    expect(engine._deliverToPot).toHaveBeenCalled();
    engine.getDynamicTarget.mockRestore();
  });

  test("pH correction is skipped if watchdog blocks", async () => {
    const Watchdog = require("../../../../src/services/watchdog");
    Watchdog.isSafeToDose.mockResolvedValueOnce(false);
    mockPrisma.telemetryLog.findFirst.mockResolvedValue({
      realPH: 7.2,
      realEC: 800,
    });
    await engine.executeTick();
    expect(engine.executePumpAndWait).not.toHaveBeenCalledWith(
      "pH_Down",
      expect.anything(),
      expect.anything(),
    );
  });

  test("handles missing systemState gracefully", async () => {
    mockPrisma.systemState.findFirst.mockResolvedValue(null);
    await expect(engine.executeTick()).rejects.toThrow("SystemState missing");
  });
});
