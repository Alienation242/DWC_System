const request = require("supertest");
const app = require("../../../src/server");
const { PrismaClient } = require("@prisma/client");
const CalibrationService = require("../../../src/services/calibrationService");

// Mock PrismaClient completely
jest.mock("@prisma/client", () => {
  const mockPrisma = {
    watchdogConfig: { findMany: jest.fn(), upsert: jest.fn() },
    systemState: { findUnique: jest.fn(), update: jest.fn() },
    batchState: { findFirst: jest.fn(), update: jest.fn() },
    $disconnect: jest.fn(),
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

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

describe("Server API Endpoints", () => {
  let prisma;

  beforeEach(() => {
    prisma = new PrismaClient();
    jest.clearAllMocks();
  });

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

  test("GET /api/watchdog/config", async () => {
    prisma.watchdogConfig.findMany.mockResolvedValue([{ pumpName: "pH_Down" }]);
    const res = await request(app).get("/api/watchdog/config");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ pumpName: "pH_Down" }]);
  });

  test("POST /api/watchdog/config upserts", async () => {
    prisma.watchdogConfig.upsert.mockResolvedValue({
      pumpName: "pH_Up",
      dailyLimitMl: 20,
    });
    const res = await request(app).post("/api/watchdog/config").send({
      pumpName: "pH_Up",
      dailyLimitMl: 20,
      cooldownSecs: 30,
      enabled: true,
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.watchdogConfig.upsert).toHaveBeenCalled();
  });

  test("GET /api/system/state", async () => {
    prisma.systemState.findUnique.mockResolvedValue({ id: 1, currentDay: 50 });
    const res = await request(app).get("/api/system/state");
    expect(res.statusCode).toBe(200);
    expect(res.body.currentDay).toBe(50);
  });

  test("POST /api/system/advance-day", async () => {
    prisma.systemState.update.mockResolvedValue({ currentDay: 51 });
    const res = await request(app).post("/api/system/advance-day");
    expect(res.statusCode).toBe(200);
    expect(res.body.currentDay).toBe(51);
  });
});
