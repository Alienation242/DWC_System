const mqtt = require("mqtt");
const { PrismaClient } = require("@prisma/client");
const EventEmitter = require("events");
const CalibrationService = require("./calibrationService");

const prisma = new PrismaClient();
const MQTT_BROKER = "mqtt://test.mosquitto.org";
const TOPIC_TELEMETRY = "kevin/dwc/sensor_node_1/telemetry";
const TOPIC_PUMP_STATUS = "kevin/dwc/pump_node_1/status";
const TOPIC_PUMP_COMMANDS = "kevin/dwc/pump_node_1/commands";
const TOPIC_CONNECTION_WILDCARD = "kevin/dwc/+/connection";

class MqttService extends EventEmitter {
  constructor(io) {
    super();
    this.io = io;
    this.client = mqtt.connect(MQTT_BROKER);
    this.hardwareStatus = "idle";
    this.seqCounter = 0;

    this.deviceRegistry = {
      sensor_node_1: "offline",
      pump_node_1: "offline",
    };

    this.client.on("connect", () => {
      console.log("✅ Connected to MQTT Broker");
      this.client.subscribe(TOPIC_TELEMETRY);
      this.client.subscribe(TOPIC_PUMP_STATUS);
      this.client.subscribe(TOPIC_CONNECTION_WILDCARD);
    });

    this.client.on("message", async (topic, message) => {
      if (topic === TOPIC_TELEMETRY) {
        await this.handleTelemetry(message);
      } else if (topic === TOPIC_PUMP_STATUS) {
        this.handleHardwareStatus(message);
      } else if (topic.endsWith("/connection")) {
        const parts = topic.split("/");
        const deviceName = parts[parts.length - 2];
        const status = message.toString();

        this.deviceRegistry[deviceName] = status;
        console.log(
          `📡 [NETWORK] ${deviceName} is now ${status.toUpperCase()}`,
        );

        this.emit("network_change", deviceName, status);
        if (this.io) this.io.emit("network_update", this.deviceRegistry);
      }
    });
  }

  nextSeq() {
    return ++this.seqCounter;
  }

  handleHardwareStatus(message) {
    try {
      const payload = JSON.parse(message.toString());
      this.hardwareStatus = payload.status;
      this.emit("hardware_status", payload.status);
      if (payload.status === "dose_complete") {
        this.emit("pump_message", {
          seq: payload.seq,
          status: "dose_complete",
          volume_ml: payload.volume_ml,
        });
      }
      if (this.hardwareStatus === "idle") {
        this.emit("hardware_idle");
      }
    } catch (err) {
      console.error("Failed to parse status:", err.message);
    }
  }

  waitForDevice(deviceName, timeoutMs = 900000) {
    return new Promise((resolve, reject) => {
      if (this.deviceRegistry[deviceName] === "online") return resolve();
      const timeout = setTimeout(() => {
        this.removeListener("network_change", onNetworkChange);
        reject(new Error(`TIMEOUT: ${deviceName} did not reconnect.`));
      }, timeoutMs);
      const onNetworkChange = (dev, status) => {
        if (dev === deviceName && status === "online") {
          clearTimeout(timeout);
          this.removeListener("network_change", onNetworkChange);
          resolve();
        }
      };
      this.on("network_change", onNetworkChange);
    });
  }

  waitForIdle(timeoutMs = 900000) {
    return new Promise((resolve, reject) => {
      if (this.hardwareStatus === "idle") return resolve();
      if (this.deviceRegistry["pump_node_1"] === "offline") {
        this.hardwareStatus = "idle";
        return reject(new Error("OFFLINE_INTERRUPT"));
      }
      const timeout = setTimeout(() => {
        cleanup();
        console.error(
          "⚠️ HARDWARE TIMEOUT: ESP32 unresponsive. Force unlocking.",
        );
        this.hardwareStatus = "idle";
        resolve();
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener("hardware_idle", onIdle);
        this.removeListener("network_change", onNetworkChange);
      };
      const onIdle = () => {
        cleanup();
        resolve();
      };
      const onNetworkChange = (device, status) => {
        if (device === "pump_node_1" && status === "offline") {
          cleanup();
          this.hardwareStatus = "idle";
          reject(new Error("OFFLINE_INTERRUPT"));
        }
      };
      this.once("hardware_idle", onIdle);
      this.on("network_change", onNetworkChange);
    });
  }

  waitForBusy(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (this.hardwareStatus === "busy") return resolve();
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("TIMEOUT: Pump did not become busy"));
      }, timeoutMs);
      const onStatusChange = (status) => {
        if (status === "busy") {
          cleanup();
          resolve();
        }
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener("hardware_status", onStatusChange);
      };
      this.on("hardware_status", onStatusChange);
    });
  }

  async handleTelemetry(message) {
    try {
      const payload = JSON.parse(message.toString());
      const realPH = await CalibrationService.convertPH(payload.rawPH);
      const realEC = await CalibrationService.convertEC(payload.rawEC);
      await prisma.telemetryLog.create({
        data: {
          rawPH: payload.rawPH,
          rawEC: payload.rawEC,
          realPH: realPH,
          realEC: realEC,
          isTankEmpty: payload.isTankEmpty || false,
          isTankOverflowing: payload.isTankOverflowing || false,
        },
      });
      console.log(
        `💾 Telemetry Logged: pH ${realPH.toFixed(2)} | EC ${Math.round(realEC)}`,
      );
      if (this.io) {
        this.io.emit("telemetry_update", { ...payload, realPH, realEC });
      }
    } catch (error) {
      console.error("❌ Failed to process telemetry:", error.message);
    }
  }

  sendCommand(action, ml = 0, target = "None") {
    const seq = this.nextSeq();
    const payload = JSON.stringify({ action, ml, target, seq });
    this.client.publish(TOPIC_PUMP_COMMANDS, payload);
    console.log(`📤 Command Sent [seq=${seq}]: ${payload}`);
  }
}

module.exports = MqttService;
