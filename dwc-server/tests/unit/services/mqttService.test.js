const MqttService = require("../../../src/services/mqttService");
const EventEmitter = require("events");
const mqtt = require("mqtt");

jest.mock("mqtt");

// Use var to avoid temporal dead zone (var is hoisted and initialized to undefined)
var mockSharedPrisma;

jest.mock("@prisma/client", () => {
  mockSharedPrisma = {
    telemetryLog: { create: jest.fn() },
  };
  return { PrismaClient: jest.fn(() => mockSharedPrisma) };
});

jest.mock("../../../src/services/calibrationService", () => ({
  convertPH: jest.fn().mockResolvedValue(6.5),
  convertEC: jest.fn().mockResolvedValue(1200),
}));

const {
  convertPH,
  convertEC,
} = require("../../../src/services/calibrationService");

describe("MqttService", () => {
  let service;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    if (mockSharedPrisma) {
      mockSharedPrisma.telemetryLog.create.mockClear();
    }
    mockClient = {
      on: jest.fn(),
      subscribe: jest.fn(),
      publish: jest.fn(),
      removeListener: jest.fn(),
    };
    mqtt.connect.mockReturnValue(mockClient);
    service = new MqttService(null);
    service.deviceRegistry["pump_node_1"] = "online";
    service.deviceRegistry["sensor_node_1"] = "online";
    const connectHandler = mockClient.on.mock.calls.find(
      (c) => c[0] === "connect",
    )?.[1];
    if (connectHandler) connectHandler();
  });

  afterEach(() => jest.clearAllMocks());

  test("nextSeq increments sequence number", () => {
    expect(service.nextSeq()).toBe(1);
    expect(service.nextSeq()).toBe(2);
  });

  test("sendCommand publishes to correct topic with seq", () => {
    const seq = service.sendCommand("dose_water", 500, "None");
    expect(mockClient.publish).toHaveBeenCalledWith(
      "kevin/dwc/pump_node_1/commands",
      JSON.stringify({ action: "dose_water", ml: 500, target: "None", seq }),
    );
  });

  test("sendCommand with explicit seq", () => {
    service.sendCommand("deliver", 100, "A", 42);
    expect(mockClient.publish).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ action: "deliver", ml: 100, target: "A", seq: 42 }),
    );
  });

  test("handleHardwareStatus emits pump_message on dose_complete", (done) => {
    const payload = { status: "dose_complete", seq: 123, volume_ml: 45.6 };
    const message = { toString: () => JSON.stringify(payload) };
    service.on("pump_message", (msg) => {
      expect(msg).toEqual({
        seq: 123,
        status: "dose_complete",
        volume_ml: 45.6,
      });
      done();
    });
    service.handleHardwareStatus(message);
  });

  test("handleHardwareStatus emits hardware_idle when status idle", (done) => {
    const payload = { status: "idle" };
    const message = { toString: () => JSON.stringify(payload) };
    service.on("hardware_idle", () => {
      done();
    });
    service.handleHardwareStatus(message);
  });

  test("waitForDevice resolves if device already online", async () => {
    service.deviceRegistry["pump_node_1"] = "online";
    await expect(service.waitForDevice("pump_node_1")).resolves.toBeUndefined();
  });

  test("waitForDevice rejects on timeout", async () => {
    service.deviceRegistry["pump_node_1"] = "offline";
    await expect(service.waitForDevice("pump_node_1", 50)).rejects.toThrow(
      "TIMEOUT",
    );
  });

  test("waitForBusy resolves when status becomes busy", async () => {
    service.hardwareStatus = "idle";
    const promise = service.waitForBusy(100);
    process.nextTick(() => {
      service.emit("hardware_status", {
        status: "busy",
        task: "dosing",
        seq: 1,
      });
    });
    await expect(promise).resolves.toBeUndefined();
  });

  test("waitForIdle resolves when hardware_idle emitted", async () => {
    service.hardwareStatus = "busy";
    service.deviceRegistry["pump_node_1"] = "online";
    const promise = service.waitForIdle(100);
    process.nextTick(() => {
      service.emit("hardware_idle");
    });
    await expect(promise).resolves.toBeUndefined();
  });

  test("handleTelemetry converts and logs to database", async () => {
    const payload = {
      rawPH: 2048,
      rawEC: 1024,
      isTankEmpty: false,
      isTankOverflowing: false,
    };
    const message = { toString: () => JSON.stringify(payload) };
    await service.handleTelemetry(message);
    expect(convertPH).toHaveBeenCalledWith(2048);
    expect(convertEC).toHaveBeenCalledWith(1024);
    // The captured mock instance is now accessible
    expect(mockSharedPrisma.telemetryLog.create).toHaveBeenCalled();
  });
});
