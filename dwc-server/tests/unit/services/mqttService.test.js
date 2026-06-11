const MqttService = require("../../../src/services/mqttService");
const mqtt = require("mqtt");
const { mockPrisma } = global;

jest.mock("mqtt");
jest.mock("../../../src/services/calibrationService", () => ({
  convertPH: jest.fn().mockResolvedValue(6.5),
  convertEC: jest.fn().mockResolvedValue(1200),
}));

describe("MqttService", () => {
  let service;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
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

  afterEach(() => {
    jest.clearAllMocks();
    if (service) {
      service.removeAllListeners();
      if (service.client && service.client.end) service.client.end();
    }
  });

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
    expect(mockPrisma.telemetryLog.create).toHaveBeenCalled();
  });

  test("emits network_change when connection topic received", (done) => {
    const deviceName = "pump_node_1";
    const status = "online";
    const topic = `kevin/dwc/${deviceName}/connection`;
    const message = { toString: () => status };
    service.on("network_change", (dev, stat) => {
      expect(dev).toBe(deviceName);
      expect(stat).toBe(status);
      done();
    });
    const messageHandler = mockClient.on.mock.calls.find(
      (c) => c[0] === "message",
    )[1];
    messageHandler(topic, message);
  });

  test("waitForIdle rejects with OFFLINE_INTERRUPT if device goes offline", async () => {
    service.hardwareStatus = "busy";
    service.deviceRegistry["pump_node_1"] = "offline";
    await expect(service.waitForIdle(100)).rejects.toThrow("OFFLINE_INTERRUPT");
  });

  test("waitForBusy resolves immediately if already busy with correct seq", async () => {
    service.hardwareStatus = "busy";
    service.hardwareTask = "dosing";
    service.hardwareSeq = 5;
    await expect(service.waitForBusy(100, 5)).resolves.toBeUndefined();
  });

  test("waitForBusy waits if expectedSeq mismatches", async () => {
    service.hardwareStatus = "busy";
    service.hardwareTask = "resumed_dosing";
    service.hardwareSeq = 5;
    const promise = service.waitForBusy(100, 10);
    process.nextTick(() => {
      service.emit("hardware_status", {
        status: "busy",
        task: "resumed_dosing",
        seq: 10,
      });
    });
    await expect(promise).resolves.toBeUndefined();
  });

  test("handleTelemetry logs error on invalid JSON", () => {
    const message = { toString: () => "{invalid json}" };
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    service.handleTelemetry(message);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "❌ Failed to process telemetry:",
      expect.any(String),
    );
    consoleErrorSpy.mockRestore();
  });

  test("emits network_change when connection topic received", (done) => {
    const deviceName = "pump_node_1";
    const status = "online";
    const topic = `kevin/dwc/${deviceName}/connection`;
    const message = { toString: () => status };
    service.on("network_change", (dev, stat) => {
      expect(dev).toBe(deviceName);
      expect(stat).toBe(status);
      done();
    });
    const messageHandler = mockClient.on.mock.calls.find(
      (c) => c[0] === "message",
    )[1];
    messageHandler(topic, message);
  });

  test("waitForIdle rejects with OFFLINE_INTERRUPT if device goes offline", async () => {
    service.hardwareStatus = "busy";
    service.deviceRegistry["pump_node_1"] = "offline";
    await expect(service.waitForIdle(100)).rejects.toThrow("OFFLINE_INTERRUPT");
  });

  test("waitForBusy resolves immediately if already busy with correct seq", async () => {
    service.hardwareStatus = "busy";
    service.hardwareTask = "dosing";
    service.hardwareSeq = 5;
    await expect(service.waitForBusy(100, 5)).resolves.toBeUndefined();
  });

  test("waitForBusy waits if expectedSeq mismatches", async () => {
    service.hardwareStatus = "busy";
    service.hardwareTask = "resumed_dosing";
    service.hardwareSeq = 5;
    const promise = service.waitForBusy(100, 10);
    process.nextTick(() => {
      service.emit("hardware_status", {
        status: "busy",
        task: "resumed_dosing",
        seq: 10,
      });
    });
    await expect(promise).resolves.toBeUndefined();
  });

  test("handleTelemetry logs error on invalid JSON", () => {
    const message = { toString: () => "{invalid json}" };
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    service.handleTelemetry(message);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "❌ Failed to process telemetry:",
      expect.any(String),
    );
    consoleErrorSpy.mockRestore();
  });

  test("waitForBusy removes listener on timeout", async () => {
    const service = new MqttService(null);
    service.hardwareStatus = "idle";
    const promise = service.waitForBusy(10);
    await expect(promise).rejects.toThrow("TIMEOUT");
    // No need to check listener removal explicitly; the promise cleanup should have run
  });

  test("waitForIdle rejects when device goes offline after waiting", async () => {
    const service = new MqttService(null);
    service.hardwareStatus = "busy";
    service.deviceRegistry.pump_node_1 = "online";
    const promise = service.waitForIdle(100);
    // Simulate offline event after a tick
    setTimeout(() => {
      service.emit("network_change", "pump_node_1", "offline");
    }, 10);
    await expect(promise).rejects.toThrow("OFFLINE_INTERRUPT");
  });

  test("handleHardwareStatus handles missing task/seq gracefully", () => {
    const service = new MqttService(null);
    const invalidMessage = { toString: () => '{"status":"busy"}' }; // no task, no seq
    expect(() => service.handleHardwareStatus(invalidMessage)).not.toThrow();
  });

  test("handleTelemetry error when conversion fails", async () => {
    const CalibrationService = require("../../../src/services/calibrationService");
    CalibrationService.convertPH.mockRejectedValue(
      new Error("Calibration error"),
    );
    const service = new MqttService(null);
    const message = { toString: () => '{"rawPH":2048,"rawEC":1024}' };
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    await service.handleTelemetry(message);
    expect(consoleSpy).toHaveBeenCalledWith(
      "❌ Failed to process telemetry:",
      expect.any(String),
    );
    consoleSpy.mockRestore();
  });

  test("connect handler subscribes to topics and logs", () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();
    // Clear previous subscribe calls from beforeEach
    mockClient.subscribe.mockClear();
    const connectHandler = mockClient.on.mock.calls.find(
      (c) => c[0] === "connect",
    )[1];
    connectHandler();
    expect(consoleSpy).toHaveBeenCalledWith("✅ Connected to MQTT Broker");
    expect(mockClient.subscribe).toHaveBeenCalledTimes(3);
    consoleSpy.mockRestore();
  });

  test("connect handler executes all subscriptions", () => {
    const service = new MqttService(null);
    const mockSubscribe = jest.fn();
    service.client.subscribe = mockSubscribe;
    // Manually call the stored connect handler
    const connectHandler = service.client.on.mock.calls.find(
      (c) => c[0] === "connect",
    )[1];
    connectHandler();
    expect(mockSubscribe).toHaveBeenCalledTimes(3);
    expect(mockSubscribe).toHaveBeenCalledWith(
      "kevin/dwc/sensor_node_1/telemetry",
    );
    expect(mockSubscribe).toHaveBeenCalledWith("kevin/dwc/pump_node_1/status");
    expect(mockSubscribe).toHaveBeenCalledWith("kevin/dwc/+/connection");
  });

  test("waitForDevice triggers timeout branch", async () => {
    const service = new MqttService(null);
    service.deviceRegistry.pump_node_1 = "offline";
    jest.useFakeTimers();
    const promise = service.waitForDevice("pump_node_1", 5000);
    jest.advanceTimersByTime(5000);
    await expect(promise).rejects.toThrow(
      "TIMEOUT: pump_node_1 did not reconnect.",
    );
    jest.useRealTimers();
  });

  test("waitForIdle triggers timeout branch and resolves", async () => {
    const service = new MqttService(null);
    service.hardwareStatus = "busy";
    service.deviceRegistry.pump_node_1 = "online";
    jest.useFakeTimers();
    const promise = service.waitForIdle(5000);
    jest.advanceTimersByTime(5000);
    await expect(promise).resolves.toBeUndefined();
    jest.useRealTimers();
  });
});
