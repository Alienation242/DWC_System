const MqttService = require("../../../src/services/mqttService");
const mqtt = require("mqtt");
const { mockPrisma } = global;

jest.mock("mqtt");
jest.mock("../../../src/services/calibrationService", () => ({
  convertPH: jest.fn().mockResolvedValue(6.5),
  convertEC: jest.fn().mockResolvedValue(1200),
}));

describe("MqttService Edge Cases", () => {
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
    // Manually set device online
    service.deviceRegistry.pump_node_1 = "online";
    // Trigger the connect handler
    const connectHandler = mockClient.on.mock.calls.find(
      (c) => c[0] === "connect",
    )[1];
    if (connectHandler) connectHandler();
  });

  afterEach(() => {
    if (service) service.removeAllListeners();
  });

  afterAll(() => {
    jest.useRealTimers();
    if (service) service.removeAllListeners();
  });

  test("waitForDevice rejects on timeout", async () => {
    service.deviceRegistry.pump_node_1 = "offline";
    await expect(service.waitForDevice("pump_node_1", 10)).rejects.toThrow(
      "TIMEOUT",
    );
  });

  test("waitForBusy waits for correct sequence when already busy with mismatched seq", async () => {
    service.hardwareStatus = "busy";
    service.hardwareTask = "resumed_dosing";
    service.hardwareSeq = 5;
    const promise = service.waitForBusy(100, 10);
    // Emit correct sequence after a tick
    setTimeout(() => {
      service.emit("hardware_status", {
        status: "busy",
        task: "resumed_dosing",
        seq: 10,
      });
    }, 10);
    await expect(promise).resolves.toBeUndefined();
  });

  test("waitForIdle rejects when device goes offline", async () => {
    service.hardwareStatus = "busy";
    service.deviceRegistry.pump_node_1 = "online";
    const promise = service.waitForIdle(100);
    // Simulate network change to offline
    service.emit("network_change", "pump_node_1", "offline");
    await expect(promise).rejects.toThrow("OFFLINE_INTERRUPT");
  });

  test("waitForIdle resolves on timeout (graceful fallback)", async () => {
    service.hardwareStatus = "busy";
    service.deviceRegistry.pump_node_1 = "online";
    // No idle event, timeout will force resolve
    await expect(service.waitForIdle(50)).resolves.toBeUndefined();
  });

  test("handleHardwareStatus catches JSON parse error", () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    const message = { toString: () => "{invalid json}" };
    service.handleHardwareStatus(message);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to parse status:",
      expect.any(String),
    );
    consoleErrorSpy.mockRestore();
  });

  test("handleTelemetry catches Prisma error", async () => {
    mockPrisma.telemetryLog.create.mockRejectedValue(new Error("DB down"));
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    const payload = {
      rawPH: 2000,
      rawEC: 1000,
      isTankEmpty: false,
      isTankOverflowing: false,
    };
    const message = { toString: () => JSON.stringify(payload) };
    await service.handleTelemetry(message);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "❌ Failed to process telemetry:",
      expect.any(String),
    );
    consoleErrorSpy.mockRestore();
  });

  test("sendCommand uses explicit seq when provided", () => {
    service.sendCommand("dose_water", 100, "None", 999);
    expect(mockClient.publish).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({
        action: "dose_water",
        ml: 100,
        target: "None",
        seq: 999,
      }),
    );
  });

  test("waitForBusy with no expectedSeq resolves immediately if already busy", async () => {
    service.hardwareStatus = "busy";
    await expect(service.waitForBusy(100, null)).resolves.toBeUndefined();
  });

  test("waitForBusy ignores mismatched seq if task not resumed_dosing", async () => {
    service.hardwareStatus = "busy";
    service.hardwareTask = "dosing";
    service.hardwareSeq = 5;
    // Should resolve immediately because task is not "resumed_dosing"
    await expect(service.waitForBusy(100, 10)).resolves.toBeUndefined();
  });

  test("handleTelemetry error when io.emit fails", async () => {
    service.io = {
      emit: jest.fn(() => {
        throw new Error("io error");
      }),
    };
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    const payload = {
      rawPH: 2048,
      rawEC: 1024,
      isTankEmpty: false,
      isTankOverflowing: false,
    };
    const message = { toString: () => JSON.stringify(payload) };
    await service.handleTelemetry(message);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "❌ Failed to process telemetry:",
      expect.any(String),
    );
    consoleErrorSpy.mockRestore();
  });

  test("ignores unknown topic in message handler", () => {
    const messageHandler = mockClient.on.mock.calls.find(
      (c) => c[0] === "message",
    )[1];
    const unknownTopic = "kevin/dwc/unknown";
    const message = { toString: () => "something" };
    expect(() => messageHandler(unknownTopic, message)).not.toThrow();
  });

  test("waitForIdle triggers timeout and resolves (branch coverage)", async () => {
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
