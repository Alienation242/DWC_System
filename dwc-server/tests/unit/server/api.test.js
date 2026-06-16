const request = require("supertest");
const { app, _engine, _hardwareComms } = require("../../../src/server");
const CalibrationService = require("../../../src/services/calibrationService");
const fs = require("fs").promises;
const { mockPrisma } = global;

jest.mock("../../../src/services/calibrationService", () => ({
  load: jest.fn(),
  save: jest.fn(),
}));

jest.mock("../../../src/services/mqttService", () => {
  return jest.fn().mockImplementation(() => ({
    deviceRegistry: { pump_node_1: "online", sensor_node_1: "online" },
    sendCommand: jest.fn(),
    on: jest.fn(),
    nextSeq: jest.fn(() => 1),
  }));
});

// Removed the 'watchdog' jest.mock() completely so Express loads the REAL router!

describe("Server API Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress expected console errors to keep the test output clean
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ========== Status & Calibration ==========
  test("GET /api/status", async () => {
    const res = await request(app).get("/api/status");
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("status", "Online");
  });

  test("GET /api/calibration", async () => {
    CalibrationService.load.mockResolvedValue({ pH: {}, EC: {} });
    const res = await request(app).get("/api/calibration");
    expect(res.statusCode).toBe(200);
    expect(CalibrationService.load).toHaveBeenCalled();
  });

  test("GET /api/calibration handles error", async () => {
    CalibrationService.load.mockRejectedValue(new Error("fail"));
    const res = await request(app).get("/api/calibration");
    expect(res.statusCode).toBe(500);
  });

  test("POST /api/calibration", async () => {
    CalibrationService.load.mockResolvedValue({ pH: {}, EC: {} });
    CalibrationService.save.mockResolvedValue();
    const res = await request(app)
      .post("/api/calibration")
      .send({ pH: { rawLow: 0 }, EC: { rawHigh: 4095 } });
    expect(res.statusCode).toBe(200);
    expect(CalibrationService.save).toHaveBeenCalled();
  });

  test("POST /api/calibration handles error", async () => {
    CalibrationService.load.mockRejectedValue(new Error("fail"));
    const res = await request(app).post("/api/calibration").send({});
    expect(res.statusCode).toBe(500);
  });

  test("POST /api/calibration updates ONLY pH", async () => {
    CalibrationService.load.mockResolvedValue({ pH: {}, EC: {} });
    CalibrationService.save.mockResolvedValue();
    const res = await request(app)
      .post("/api/calibration")
      .send({ pH: { rawLow: 0 } });
    expect(res.statusCode).toBe(200);
    expect(CalibrationService.save).toHaveBeenCalled();
  });

  test("POST /api/calibration updates ONLY EC", async () => {
    CalibrationService.load.mockResolvedValue({ pH: {}, EC: {} });
    CalibrationService.save.mockResolvedValue();
    const res = await request(app)
      .post("/api/calibration")
      .send({ EC: { rawHigh: 4095 } });
    expect(res.statusCode).toBe(200);
    expect(CalibrationService.save).toHaveBeenCalled();
  });

  // ========== Nutrient Configuration ==========
  test("GET /api/nutrient-config returns profile", async () => {
    const mockProfile = { carrierFluid: "Water", carrierVolumeMl: 500 };
    jest.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(mockProfile));
    const res = await request(app).get("/api/nutrient-config");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(mockProfile);
  });

  test("GET /api/nutrient-config handles read error", async () => {
    jest.spyOn(fs, "readFile").mockRejectedValue(new Error("file missing"));
    const res = await request(app).get("/api/nutrient-config");
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("Failed to load nutrient profile.");
  });

  test("GET /api/nutrient-config handles invalid JSON", async () => {
    jest.spyOn(fs, "readFile").mockResolvedValue("{invalid json}");
    const res = await request(app).get("/api/nutrient-config");
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("Failed to load nutrient profile.");
  });

  test("POST /api/nutrient-config saves profile", async () => {
    const newProfile = { carrierFluid: "RO", carrierVolumeMl: 1000 };
    jest.spyOn(fs, "writeFile").mockResolvedValue();
    const res = await request(app)
      .post("/api/nutrient-config")
      .send(newProfile);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify(newProfile, null, 2),
    );
  });

  test("POST /api/nutrient-config handles write error", async () => {
    jest
      .spyOn(fs, "writeFile")
      .mockRejectedValue(new Error("permission denied"));
    const res = await request(app).post("/api/nutrient-config").send({});
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("Failed to save nutrient profile.");
  });

  // ========== Watchdog Configuration ==========
  test("GET /api/watchdog/config", async () => {
    mockPrisma.watchdogConfig.findMany.mockResolvedValue([
      { pumpName: "pH_Down", dailyLimitMl: 20 },
    ]);
    const res = await request(app).get("/api/watchdog/config");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ pumpName: "pH_Down", dailyLimitMl: 20 }]);
  });

  test("GET /api/watchdog/config handles error", async () => {
    mockPrisma.watchdogConfig.findMany.mockRejectedValue(new Error("DB error"));
    const res = await request(app).get("/api/watchdog/config");
    expect(res.statusCode).toBe(500);
  });

  test("POST /api/watchdog/config upserts", async () => {
    mockPrisma.watchdogConfig.upsert.mockResolvedValue({
      pumpName: "Micro",
      dailyLimitMl: 30,
    });
    const res = await request(app).post("/api/watchdog/config").send({
      pumpName: "Micro",
      dailyLimitMl: 30,
      cooldownSecs: 45,
      enabled: true,
    });
    expect(res.statusCode).toBe(200);
  });

  test("POST /api/watchdog/config handles error", async () => {
    mockPrisma.watchdogConfig.upsert.mockRejectedValue(new Error("DB error"));
    const res = await request(app).post("/api/watchdog/config").send({});
    expect(res.statusCode).toBe(500);
  });

  // ========== System State & Control ==========
  test("GET /api/system/state", async () => {
    mockPrisma.systemState.findUnique.mockResolvedValue({
      id: 1,
      currentDay: 50,
    });
    const res = await request(app).get("/api/system/state");
    expect(res.statusCode).toBe(200);
    expect(res.body.currentDay).toBe(50);
  });

  test("POST /api/system/advance-day", async () => {
    mockPrisma.systemState.update.mockResolvedValue({ currentDay: 51 });
    const res = await request(app).post("/api/system/advance-day");
    expect(res.statusCode).toBe(200);
    expect(res.body.currentDay).toBe(51);
  });

  test("POST /api/system/override changes automation mode", async () => {
    mockPrisma.systemState.update.mockResolvedValue({
      automationMode: "MANUAL_OVERRIDE",
    });
    const res = await request(app)
      .post("/api/system/override")
      .send({ mode: "MANUAL_OVERRIDE" });
    expect(res.statusCode).toBe(200);
    expect(res.body.automationMode).toBe("MANUAL_OVERRIDE");
  });

  test("GET /api/system/target returns calculated targets", async () => {
    mockPrisma.systemState.findFirst.mockResolvedValue({
      id: 1,
      currentDay: 50,
    });
    jest
      .spyOn(_engine, "_loadTickConfigs")
      .mockResolvedValue({ strainProfile: {} });
    jest
      .spyOn(_engine, "getDynamicTarget")
      .mockReturnValue({ targetPPM: 900, phase: "BULKING" });

    const res = await request(app).get("/api/system/target");
    expect(res.statusCode).toBe(200);
    expect(res.body.targetPPM).toBe(900);
    expect(res.body.phase).toBe("BULKING");
  });

  test("GET /api/system/target handles no system state", async () => {
    mockPrisma.systemState.findFirst.mockResolvedValue(null);
    const res = await request(app).get("/api/system/target");
    expect(res.statusCode).toBe(404);
  });

  test("GET /api/system/target handles error", async () => {
    mockPrisma.systemState.findFirst.mockRejectedValue(new Error("DB error"));
    const res = await request(app).get("/api/system/target");
    expect(res.statusCode).toBe(500);
  });

  test("POST /api/system/override handles database failure", async () => {
    mockPrisma.systemState.update.mockRejectedValue(new Error("DB Error"));
    const res = await request(app)
      .post("/api/system/override")
      .send({ mode: "AUTO" });
    expect(res.statusCode).toBe(500);
  });

  // ========== Telemetry Logs ==========
  test("GET /api/telemetry/latest/:potId", async () => {
    mockPrisma.telemetryLog.findFirst.mockResolvedValue({ realPH: 5.8 });
    const res = await request(app).get("/api/telemetry/latest/A");
    expect(res.statusCode).toBe(200);
    expect(res.body.realPH).toBe(5.8);
  });

  test("GET /api/telemetry/latest/:potId handles error", async () => {
    mockPrisma.telemetryLog.findFirst.mockRejectedValue(new Error("DB error"));
    const res = await request(app).get("/api/telemetry/latest/A");
    expect(res.statusCode).toBe(500);
  });

  test("GET /api/telemetry/history/:potId", async () => {
    mockPrisma.telemetryLog.findMany.mockResolvedValue([{ realPH: 5.8 }]);
    const res = await request(app).get("/api/telemetry/history/A");
    expect(res.statusCode).toBe(200);
    expect(res.body[0].realPH).toBe(5.8);
  });

  test("GET /api/telemetry/history/:potId handles error", async () => {
    mockPrisma.telemetryLog.findMany.mockRejectedValue(new Error("DB error"));
    const res = await request(app).get("/api/telemetry/history/A");
    expect(res.statusCode).toBe(500);
  });

  test("GET /api/telemetry/doses/:potId", async () => {
    mockPrisma.doseLog.findMany = jest.fn().mockResolvedValue([{ ml: 10 }]);
    const res = await request(app).get("/api/telemetry/doses/A");
    expect(res.statusCode).toBe(200);
    expect(res.body[0].ml).toBe(10);
  });

  test("GET /api/telemetry/doses/:potId handles error", async () => {
    mockPrisma.doseLog.findMany = jest
      .fn()
      .mockRejectedValue(new Error("DB error"));
    const res = await request(app).get("/api/telemetry/doses/A");
    expect(res.statusCode).toBe(500);
  });

  test("GET /api/telemetry/pots", async () => {
    mockPrisma.telemetryLog.findMany.mockResolvedValue([
      { potId: "A" },
      { potId: "B" },
    ]);
    const res = await request(app).get("/api/telemetry/pots");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(["A", "B"]);
  });

  test("GET /api/telemetry/pots handles error", async () => {
    mockPrisma.telemetryLog.findMany.mockRejectedValue(new Error("DB error"));
    const res = await request(app).get("/api/telemetry/pots");
    expect(res.statusCode).toBe(500);
  });

  // ========== Manual Controls ==========
  test("POST /api/manual/stop triggers emergency stop", async () => {
    const res = await request(app).post("/api/manual/stop");
    expect(res.statusCode).toBe(200);
    expect(_hardwareComms.sendCommand).toHaveBeenCalledWith(
      "stop",
      0,
      "None",
      1,
    );
  });

  test("POST /api/manual/stop handles error", async () => {
    _hardwareComms.sendCommand.mockImplementationOnce(() => {
      throw new Error("Mqtt Error");
    });
    const res = await request(app).post("/api/manual/stop");
    expect(res.statusCode).toBe(500);
  });

  test("POST /api/manual/dose rejects missing parameters", async () => {
    const res = await request(app).post("/api/manual/dose").send({});
    expect(res.statusCode).toBe(400);
  });

  test("POST /api/manual/dose succeeds for standard nutrients", async () => {
    jest.spyOn(_engine, "executePumpAndWait").mockResolvedValue(15);
    const res = await request(app)
      .post("/api/manual/dose")
      .send({ pumpName: "Micro", actionStr: "dose_micro", ml: 15 });
    expect(res.statusCode).toBe(200);
    expect(res.body.dosedMl).toBe(15);
    expect(_engine.executePumpAndWait).toHaveBeenCalledWith(
      "Micro",
      "dose_micro",
      15,
      { potId: "A" },
    );
  });

  test("POST /api/manual/dose sequences carrier water when dosing pH", async () => {
    jest
      .spyOn(_engine, "executePumpAndWait")
      .mockResolvedValueOnce(250) // Carrier water
      .mockResolvedValueOnce(5); // pH Down

    const res = await request(app)
      .post("/api/manual/dose")
      .send({ pumpName: "pH_Down", actionStr: "dose_ph_down", ml: 5 });
    expect(res.statusCode).toBe(200);
    expect(res.body.dosedMl).toBe(255);
  });

  test("POST /api/manual/dose handles engine errors", async () => {
    jest
      .spyOn(_engine, "executePumpAndWait")
      .mockRejectedValue(new Error("Engine blocked"));
    const res = await request(app)
      .post("/api/manual/dose")
      .send({ pumpName: "Micro", actionStr: "dose_micro", ml: 15 });
    expect(res.statusCode).toBe(500);
  });

  test("POST /api/manual/deliver rejects missing parameters", async () => {
    const res = await request(app).post("/api/manual/deliver").send({});
    expect(res.statusCode).toBe(400);
  });

  test("POST /api/manual/deliver succeeds", async () => {
    jest.spyOn(_engine, "_deliverToPot").mockResolvedValue();
    const res = await request(app)
      .post("/api/manual/deliver")
      .send({ target: "A", volumeMl: 5000 });
    expect(res.statusCode).toBe(200);
    expect(_engine._deliverToPot).toHaveBeenCalledWith(5000, "A");
  });

  test("POST /api/manual/deliver handles errors", async () => {
    jest
      .spyOn(_engine, "_deliverToPot")
      .mockRejectedValue(new Error("Engine busy"));
    const res = await request(app)
      .post("/api/manual/deliver")
      .send({ target: "A", volumeMl: 5000 });
    expect(res.statusCode).toBe(500);
  });
});
