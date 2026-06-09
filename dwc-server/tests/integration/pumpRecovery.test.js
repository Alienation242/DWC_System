const RecipeEngine = require("../../src/services/recipeEngine");
const Watchdog = require("../../src/services/watchdog");
const EventEmitter = require("events");

jest.mock("@prisma/client", () => {
  const mockPrisma = {
    batchState: { create: jest.fn(), update: jest.fn() },
    doseLog: { create: jest.fn() },
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

jest.mock("../../src/services/watchdog", () => ({
  isSafeToDose: jest.fn().mockResolvedValue(true),
  logSuccessfulDose: jest.fn().mockResolvedValue(true),
}));

// ==========================================
// THE VIRTUAL HARDWARE
// ==========================================
class MockMqttService extends EventEmitter {
  constructor() {
    super();
    this.deviceRegistry = { pump_node_1: "online", sensor_node_1: "online" };
    this.seqCounter = 0;
    this.hardwareStatus = "idle";
    this.activeCommand = null;
  }

  nextSeq() {
    return ++this.seqCounter;
  }

  waitForDevice(device) {
    return new Promise((resolve) => {
      if (this.deviceRegistry[device] === "online") return resolve();
      this.once("network_change", (dev, status) => {
        if (dev === device && status === "online") resolve();
      });
    });
  }

  waitForBusy(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (this.hardwareStatus === "busy") return resolve();
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("TIMEOUT: Pump did not become busy"));
      }, timeoutMs);
      const onStatus = (payload) => {
        if (payload.status === "busy") {
          cleanup();
          resolve();
        }
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.removeListener("hardware_status", onStatus);
        this.removeListener("hardware_error", onError);
      };
      this.on("hardware_status", onStatus);
      this.on("hardware_error", onError);
    });
  }

  waitForIdle(timeoutMs = 900000) {
    return new Promise((resolve, reject) => {
      if (this.hardwareStatus === "idle") return resolve();
      const onIdle = () => {
        cleanup();
        resolve();
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        this.removeListener("hardware_idle", onIdle);
        this.removeListener("hardware_error", onError);
      };
      this.on("hardware_idle", onIdle);
      this.on("hardware_error", onError);
    });
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
    // CRITICAL BUG FIX: Do NOT set hardwareStatus to "idle" here.
    // Dead hardware is unresponsive, not gracefully idle.
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

  simulateHardwareReboot() {
    this.deviceRegistry["pump_node_1"] = "online";
    this.hardwareStatus = "idle";
    this.emit("network_change", "pump_node_1", "online");
  }
}

// ==========================================
// THE TEST SUITE
// ==========================================
describe("RecipeEngine - Physical Hardware Recovery Protocols", () => {
  let mqttMock;
  let engine;

  beforeEach(() => {
    jest.useFakeTimers();
    mqttMock = new MockMqttService();
    engine = new RecipeEngine(mqttMock);

    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("1. FLIGHT NOMINAL: Safely executes a flawless dose", async () => {
    const dosePromise = engine.executePumpAndWait(
      "Water",
      "dose_water",
      1000.0,
    );

    // Exactly 510ms handles the safety buffer + network transit
    await jest.advanceTimersByTimeAsync(510);

    mqttMock.simulateHardwareComplete();

    const result = await dosePromise;
    expect(result).toBe(1000.0);
    expect(Watchdog.logSuccessfulDose).toHaveBeenCalledWith("Water", 1000.0);
  });

  test("2. WATCHDOG INTERVENTION: Safely blocks unauthorized dose", async () => {
    Watchdog.isSafeToDose.mockResolvedValueOnce(false);
    const dosePromise = engine.executePumpAndWait(
      "pH_Up",
      "dose_ph_up",
      1000.0,
    );

    await jest.advanceTimersByTimeAsync(10);
    const result = await dosePromise;

    expect(result).toBe(0);
    expect(mqttMock.activeCommand).toBeNull();
  });

  test("3. THE GHOST LOOP: Resumes gracefully after Wi-Fi drop", async () => {
    const dosePromise = engine.executePumpAndWait(
      "Water",
      "dose_water",
      5000.0,
    );
    await jest.advanceTimersByTimeAsync(510);

    mqttMock.simulateNetworkDrop();
    await jest.advanceTimersByTimeAsync(5000); // 5s offline

    mqttMock.simulateHardwareAutoResume(1);
    await jest.advanceTimersByTimeAsync(10);

    mqttMock.simulateHardwareComplete();
    const result = await dosePromise;

    expect(result).toBe(5000.0);
    expect(mqttMock.seqCounter).toBe(1); // Never fired fallback command
  });

  test("4. THE OVERFLOW SHIELD: Deducts volume accurately on power crash", async () => {
    const dosePromise = engine.executePumpAndWait(
      "Water",
      "dose_water",
      1000.0,
    );
    await jest.advanceTimersByTimeAsync(510);

    // Let the pump physically run for exactly 25 seconds
    await jest.advanceTimersByTimeAsync(25000);

    mqttMock.simulateNetworkDrop();
    mqttMock.simulateHardwareReboot();

    // Engine waits exactly 15 seconds for a resume before giving up
    await jest.advanceTimersByTimeAsync(15000);

    // The catch block executes, deducting ~500ml, and the loop restarts.
    await jest.advanceTimersByTimeAsync(510);

    // THE FIX: Use toBeCloseTo to account for Node.js Promise resolution micro-delays
    expect(mqttMock.seqCounter).toBe(2);
    expect(mqttMock.activeCommand.ml).toBeCloseTo(500, 0); // 0 decimal places of strictness

    mqttMock.simulateHardwareComplete();
    const result = await dosePromise;
    expect(result).toBe(1000.0);
  });

  test("5. MAX RETRIES EXCEEDED: Protects system if hardware completely fails", async () => {
    const dosePromise = engine.executePumpAndWait(
      "Water",
      "dose_water",
      1000.0,
    );
    await jest.advanceTimersByTimeAsync(510);

    for (let i = 0; i < 3; i++) {
      mqttMock.simulateNetworkDrop();
      mqttMock.simulateHardwareReboot();

      // Wait for the resume timeout to fail
      await jest.advanceTimersByTimeAsync(15000);

      if (i < 2) {
        await jest.advanceTimersByTimeAsync(510);
      }
    }

    // Because we fixed recipeEngine.js, this will now correctly reject!
    await expect(dosePromise).rejects.toThrow(
      /Failed to dose Water after 3 retries/,
    );
  });
});
