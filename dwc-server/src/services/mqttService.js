const mqtt = require("mqtt");
const { PrismaClient } = require("@prisma/client");
const EventEmitter = require("events");
const CalibrationService = require("./calibrationService");

const prisma = new PrismaClient();
const MQTT_BROKER = "mqtt://test.mosquitto.org";
const TOPIC_TELEMETRY_WILDCARD = "kevin/dwc/+/telemetry";
const TOPIC_PUMP_STATUS = "kevin/dwc/pump_node_1/status";
const TOPIC_PUMP_COMMANDS = "kevin/dwc/pump_node_1/commands";
const TOPIC_CONNECTION_WILDCARD = "kevin/dwc/+/connection";

function nodeNameToPotId(nodeName) {
  const match = nodeName.match(/sensor_node_(\d+)/);
  if (!match) return "A";
  const num = parseInt(match[1]);
  return String.fromCharCode(64 + num);
}

class MqttService extends EventEmitter {
  constructor(io) {
    super();
    this.io = io;
    this.client = mqtt.connect(MQTT_BROKER);
    this.hardwareStatus = "idle";
    this.seqCounter = 0;

    this.deviceRegistry = {};

    this.client.on("connect", () => {
      console.log("✅ Connected to MQTT Broker");
      this.client.subscribe(TOPIC_TELEMETRY_WILDCARD);
      this.client.subscribe(TOPIC_PUMP_STATUS);
      this.client.subscribe(TOPIC_CONNECTION_WILDCARD);
    });

    this.client.on("message", async (topic, message) => {
      if (topic.endsWith("/telemetry")) {
        const parts = topic.split("/");
        const nodeName = parts[2];
        const potId = nodeNameToPotId(nodeName);
        await this.handleTelemetry(message, potId);
      } else if (topic === TOPIC_PUMP_STATUS) {
        this.handleHardwareStatus(message);
      } else if (topic.endsWith("/connection")) {
        const parts = topic.split("/");
        const nodeName = parts[2];
        const potId = nodeNameToPotId(nodeName);
        const status = message.toString();
        this.deviceRegistry[nodeName] = status;
        console.log(
          `📡 [NETWORK] ${nodeName} (pot ${potId}) is now ${status.toUpperCase()}`,
        );
        this.emit("network_change", nodeName, status, potId);
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
      this.hardwareTask = payload.task;
      this.hardwareSeq = payload.seq;
      this.emit("hardware_status", payload);
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

  waitForBusy(timeoutMs = 30000, expectedSeq = null) {
    return new Promise((resolve, reject) => {
      // THE FIX: Check sequence even if it is already busy
      if (this.hardwareStatus === "busy") {
        if (
          expectedSeq &&
          this.hardwareTask === "resumed_dosing" &&
          this.hardwareSeq !== expectedSeq
        ) {
          // Wrong sequence, keep waiting
        } else {
          return resolve();
        }
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("TIMEOUT: Pump did not become busy"));
      }, timeoutMs);

      const onStatusChange = (payload) => {
        const status = typeof payload === "string" ? payload : payload.status;
        const task = typeof payload === "string" ? null : payload.task;
        const seq = typeof payload === "string" ? null : payload.seq;

        if (status === "busy") {
          if (expectedSeq && task === "resumed_dosing" && seq !== expectedSeq) {
            return;
          }
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

  async handleTelemetry(message, potId) {
    try {
      const payload = JSON.parse(message.toString());
      const realPH = await CalibrationService.convertPH(payload.rawPH);
      const realEC = await CalibrationService.convertEC(payload.rawEC);
      await prisma.telemetryLog.create({
        data: {
          potId,
          rawPH: payload.rawPH,
          rawEC: payload.rawEC,
          realPH,
          realEC,
          isTankEmpty: payload.isTankEmpty || false,
          isTankOverflowing: payload.isTankOverflowing || false,
        },
      });
      console.log(
        `💾 Telemetry Logged (pot ${potId}): pH ${realPH.toFixed(2)} | EC ${Math.round(realEC)}`,
      );

      this.emit("telemetry", {
        potId,
        rawPH: payload.rawPH,
        rawEC: payload.rawEC,
        realPH,
        realEC,
      });
      if (this.io) {
        this.io.emit("telemetry_update", {
          potId,
          ...payload,
          realPH,
          realEC,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("❌ Failed to process telemetry:", error.message);
    }
  }

  sendCommand(action, ml = 0, target = "None", explicitSeq = null) {
    const seq = explicitSeq !== null ? explicitSeq : this.nextSeq();
    const payload = JSON.stringify({ action, ml, target, seq });
    this.client.publish(TOPIC_PUMP_COMMANDS, payload);
    console.log(`📤 Command Sent [seq=${seq}]: ${payload}`);
    return seq;
  }
}

module.exports = MqttService;
