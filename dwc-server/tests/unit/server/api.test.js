const request = require("supertest");
const app = require("../../../src/server");
const CalibrationService = require("../../../src/services/calibrationService");
const fs = require("fs").promises;
const mockPrisma = require("../../../mocks/mockPrisma"); // <-- add this

// Mock calibration service
jest.mock("../../../src/services/calibrationService", () => ({
  load: jest.fn(),
  save: jest.fn(),
}));

// Mock MqttService to avoid network connections
jest.mock("../../../src/services/mqttService", () => {
  return jest.fn().mockImplementation(() => ({
    deviceRegistry: { pump_node_1: "online", sensor_node_1: "online" },
    sendCommand: jest.fn(),
    on: jest.fn(),
    nextSeq: jest.fn(() => 1),
  }));
});

// Mock file system for nutrient config endpoints
jest.mock("fs", () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
}));

describe("Server API Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  test("POST /api/calibration", async () => {
    CalibrationService.load.mockResolvedValue({ pH: {}, EC: {} });
    CalibrationService.save.mockResolvedValue();
    const res = await request(app)
      .post("/api/calibration")
      .send({ pH: { rawLow: 0 }, EC: { rawHigh: 4095 } });
    expect(res.statusCode).toBe(200);
    expect(CalibrationService.save).toHaveBeenCalled();
  });

  // ========== Nutrient Configuration ==========
  test("GET /api/nutrient-config returns profile", async () => {
    const mockProfile = { carrierFluid: "Water", carrierVolumeMl: 500 };
    fs.readFile.mockResolvedValue(JSON.stringify(mockProfile));
    const res = await request(app).get("/api/nutrient-config");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(mockProfile);
  });

  test("GET /api/nutrient-config handles read error", async () => {
    fs.readFile.mockRejectedValue(new Error("file missing"));
    const res = await request(app).get("/api/nutrient-config");
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("Failed to load nutrient profile.");
  });

  test("POST /api/nutrient-config saves profile", async () => {
    const newProfile = { carrierFluid: "RO", carrierVolumeMl: 1000 };
    fs.writeFile.mockResolvedValue();
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
    fs.writeFile.mockRejectedValue(new Error("permission denied"));
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
    expect(mockPrisma.watchdogConfig.upsert).toHaveBeenCalledWith({
      where: { pumpName: "Micro" },
      update: { dailyLimitMl: 30, cooldownSecs: 45, enabled: true },
      create: {
        pumpName: "Micro",
        dailyLimitMl: 30,
        cooldownSecs: 45,
        enabled: true,
      },
    });
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
});
