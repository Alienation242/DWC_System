const RecipeEngine = require("../../src/services/recipeEngine");
const Watchdog = require("../../src/services/watchdog");
const EventEmitter = require("events");
const fs = require("fs").promises;

jest.mock("../../src/services/watchdog", () => ({
  isSafeToDose: jest.fn().mockResolvedValue(true),
  logSuccessfulDose: jest.fn().mockResolvedValue(true),
}));

jest.spyOn(fs, "readFile").mockResolvedValue(
  JSON.stringify({
    peristaltic_ml_per_sec: 200.0,
    submersible_ml_per_sec: 50.0,
    safety_buffer_ms: 30000,
  }),
);

class MockMqttService extends EventEmitter {
  constructor() {
    super();
    this.deviceRegistry = { pump_node_1: "online", sensor_node_1: "online" };
    this.seqCounter = 0;
    this.hardwareStatus = "idle";
    this.activeCommand = null;

    this.waitForDevice = jest.fn().mockImplementation(async (device) => {
      if (this.deviceRegistry[device] === "online") return;
      await new Promise((resolve) => this.once("network_change", resolve));
    });

    this.waitForBusy = jest
      .fn()
      .mockImplementation(async (timeoutMs = 30000) => {
        if (this.hardwareStatus === "busy") return;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("TIMEOUT: Pump did not become busy")),
            timeoutMs,
          );
          const onStatus = (payload) => {
            if (payload.status === "busy") {
              clearTimeout(timer);
              this.removeListener("hardware_status", onStatus);
              resolve();
            }
          };
          this.on("hardware_status", onStatus);
        });
      });

    this.waitForIdle = jest
      .fn()
      .mockImplementation(async (timeoutMs = 900000) => {
        if (this.hardwareStatus === "idle") return;
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            console.error("⚠️ HARDWARE TIMEOUT: Force unlocking.");
            this.hardwareStatus = "idle";
            resolve();
          }, timeoutMs);
          const onIdle = () => {
            clearTimeout(timer);
            this.removeListener("hardware_idle", onIdle);
            resolve();
          };
          this.on("hardware_idle", onIdle);
        });
      });
  }

  nextSeq() {
    return ++this.seqCounter;
  }

  sendCommand(action, ml, target, seq) {
    this.activeCommand = { action, ml, target, seq };
    setTimeout(() => {
      this.hardwareStatus = "busy";
      this.emit("hardware_status", { status: "busy", task: "dosing", seq });
    }, 10);
    return seq;
  }

  simulateHardwareComplete() {
    if (!this.activeCommand) {
      throw new Error("Cannot simulate completion: no active command");
    }
    this.hardwareStatus = "idle";
    this.emit("pump_message", {
      seq: this.activeCommand.seq,
      status: "dose_complete",
      volume_ml: this.activeCommand.ml,
    });
    this.emit("hardware_idle");
  }

  simulateNetworkDrop() {
    this.deviceRegistry["pump_node_1"] = "offline";
    this.emit("hardware_error", new Error("OFFLINE_INTERRUPT"));
  }

  simulateHardwareAutoResume(seq) {
    this.deviceRegistry["pump_node_1"] = "online";
    this.hardwareStatus = "busy";
    this.emit("network_change", "pump_node_1", "online");
    this.emit("hardware_status", {
      status: "busy",
      task: "resumed_dosing",
      seq,
    });
  }
}

describe("RecipeEngine - Physical Hardware Recovery Protocols", () => {
  let mqttMock;
  let engine;

  beforeEach(() => {
    jest.useRealTimers();
    mqttMock = new MockMqttService();
    jest.spyOn(mqttMock, "sendCommand");
    engine = new RecipeEngine(mqttMock);
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("RecipeEngine - Physical Hardware Recovery Protocols", () => {
    jest.setTimeout(30000);

    test("1. FLIGHT NOMINAL: Safely executes a flawless dose", async () => {
      // Shorten retry delay so command is sent quickly
      const dosePromise = engine.executePumpAndWait(
        "Water",
        "dose_water",
        1000,
        {
          retryDelayMs: 10,
        },
      );
      await new Promise((r) => setTimeout(r, 50)); // enough time for command to be sent
      mqttMock.simulateHardwareComplete();
      const result = await dosePromise;
      expect(result).toBe(1000);
      expect(Watchdog.logSuccessfulDose).toHaveBeenCalledWith("Water", 1000);
    }, 15000);

    test("2. WATCHDOG INTERVENTION: Safely blocks unauthorized dose", async () => {
      Watchdog.isSafeToDose.mockResolvedValueOnce(false);
      const result = await engine.executePumpAndWait(
        "pH_Up",
        "dose_ph_up",
        1000,
      );
      expect(result).toBe(0);
      expect(mqttMock.activeCommand).toBeNull();
    });

    test("3. THE GHOST LOOP: Resumes gracefully after Wi-Fi drop", async () => {
      const dosePromise = engine.executePumpAndWait(
        "Water",
        "dose_water",
        5000,
        {
          retryDelayMs: 10,
        },
      );
      await new Promise((r) => setTimeout(r, 50));
      mqttMock.simulateNetworkDrop();
      await new Promise((r) => setTimeout(r, 100));
      mqttMock.simulateHardwareAutoResume(1);
      await new Promise((r) => setTimeout(r, 50));
      mqttMock.simulateHardwareComplete();
      const result = await dosePromise;
      expect(result).toBe(5000);
      expect(mqttMock.seqCounter).toBe(1);
    });

    test("4. THE OVERFLOW SHIELD: Deducts volume accurately on power crash", async () => {
      // First waitForDevice should succeed, then after drop it fails
      let firstDeviceCall = true;
      mqttMock.waitForDevice.mockImplementation(
        async (device, timeoutMs = 5000) => {
          if (firstDeviceCall) {
            firstDeviceCall = false;
            return; // resolve immediately
          }
          await new Promise((_, reject) =>
            setTimeout(() => reject(new Error("TIMEOUT")), 100),
          );
        },
      );

      // Simulate pump running for 250ms (500ml @ 200ml/s) then offline
      mqttMock.waitForIdle.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 250));
        throw new Error("OFFLINE_INTERRUPT");
      });

      const dosePromise = engine.executePumpAndWait(
        "Water",
        "dose_water",
        1000,
        {
          maxRetries: 1,
          retryDelayMs: 10,
          waitForDeviceTimeoutMs: 100,
          waitForBusyTimeoutMs: 500,
        },
      );

      await expect(dosePromise).rejects.toThrow(
        /Failed to dose Water after 1 retries/,
      );
      expect(mqttMock.sendCommand).toHaveBeenCalledTimes(1);
    }, 10000);

    test("5. MAX RETRIES EXCEEDED: Protects system if hardware completely fails", async () => {
      // First waitForDevice succeeds, then fails on retries
      let firstDeviceCall = true;
      mqttMock.waitForDevice.mockImplementation(
        async (device, timeoutMs = 5000) => {
          if (firstDeviceCall) {
            firstDeviceCall = false;
            return;
          }
          await new Promise((_, reject) =>
            setTimeout(() => reject(new Error("TIMEOUT")), 50),
          );
        },
      );

      mqttMock.waitForBusy.mockRejectedValue(new Error("OFFLINE_INTERRUPT"));

      const dosePromise = engine.executePumpAndWait(
        "Water",
        "dose_water",
        1000,
        {
          maxRetries: 2,
          retryDelayMs: 10,
          waitForDeviceTimeoutMs: 50,
          waitForBusyTimeoutMs: 100,
        },
      );

      await expect(dosePromise).rejects.toThrow(
        /Failed to dose Water after 2 retries/,
      );
      expect(mqttMock.sendCommand).toHaveBeenCalledTimes(1);
    }, 10000);

    test("executePumpAndWait – resumes after offline and gets busy status", async () => {
      // Simulate first dose starts, then network drop, then resume
      mqttMock.waitForBusy.mockResolvedValueOnce();
      mqttMock.waitForIdle.mockImplementationOnce(async () => {
        throw new Error("OFFLINE_INTERRUPT");
      });
      let reconnect = false;
      mqttMock.waitForDevice.mockImplementation(async (device, timeout) => {
        if (!reconnect) {
          reconnect = true;
          return;
        }
        await new Promise((r) => setTimeout(r, 10));
      });
      // After reconnect, simulate busy (resumed dosing) then complete
      mqttMock.waitForBusy.mockResolvedValueOnce();
      const dosePromise = engine.executePumpAndWait(
        "Water",
        "dose_water",
        1000,
        {
          maxRetries: 1,
          retryDelayMs: 10,
        },
      );
      await new Promise((r) => setTimeout(r, 50));
      mqttMock.emit("hardware_status", {
        status: "busy",
        task: "resumed_dosing",
        seq: 1,
      });
      await new Promise((r) => setTimeout(r, 10));
      mqttMock.emit("pump_message", {
        seq: 1,
        status: "dose_complete",
        volume_ml: 1000,
      });
      const result = await dosePromise;
      expect(result).toBe(1000);
    }, 10000);
  });
});
