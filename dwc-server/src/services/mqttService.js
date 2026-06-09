const mqtt = require("mqtt");
const { PrismaClient } = require("@prisma/client");
const EventEmitter = require("events");
const CalibrationService = require("./calibrationService");

const prisma = new PrismaClient();
const MQTT_BROKER = "mqtt://test.mosquitto.org";
const TOPIC_TELEMETRY = "kevin/dwc/sensor_node_1/telemetry";
const TOPIC_PUMP_STATUS = "kevin/dwc/pump_node_1/status";
const TOPIC_PUMP_COMMANDS = "kevin/dwc/pump_node_1/commands";

class MqttService extends EventEmitter {
  constructor(io) {
    super();
    this.io = io;
    this.client = mqtt.connect(MQTT_BROKER);
    this.hardwareStatus = "idle";

    this.client.on("connect", () => {
      console.log("✅ Connected to MQTT Broker");
      this.client.subscribe(TOPIC_TELEMETRY);
      this.client.subscribe(TOPIC_PUMP_STATUS);
    });

    this.client.on("message", async (topic, message) => {
      if (topic === TOPIC_TELEMETRY) {
        await this.handleTelemetry(message);
      } else if (topic === TOPIC_PUMP_STATUS) {
        this.handleHardwareStatus(message);
      }
    });
  }

  handleHardwareStatus(message) {
    try {
      const payload = JSON.parse(message.toString());
      this.hardwareStatus = payload.status; // "idle" or "busy"

      // Emit the event so our RecipeEngine can await it!
      if (this.hardwareStatus === "idle") {
        this.emit("hardware_idle");
      }
    } catch (err) {
      console.error("Failed to parse status:", err.message);
    }
  }

  // A helper function that returns a Promise that resolves ONLY when the ESP32 is idle
  waitForIdle(timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      if (this.hardwareStatus === "idle") return resolve();

      const timeout = setTimeout(() => {
        this.removeListener("hardware_idle", onIdle);
        reject(
          new Error("Hardware timeout: ESP32 took too long to return idle."),
        );
      }, timeoutMs);

      const onIdle = () => {
        clearTimeout(timeout);
        resolve();
      };

      this.once("hardware_idle", onIdle);
    });
  }

  async handleTelemetry(message) {
    try {
      const payload = JSON.parse(message.toString());

      // 1. Convert to real values FIRST
      const realPH = await CalibrationService.convertPH(payload.rawPH);
      const realEC = await CalibrationService.convertEC(payload.rawEC);

      // 2. Save BOTH raw and real data to the database
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

      // 3. Broadcast to the Vue Dashboard instantly
      if (this.io) {
        this.io.emit("telemetry_update", {
          ...payload,
          realPH,
          realEC,
        });
      }
    } catch (error) {
      console.error("❌ Failed to process telemetry:", error.message);
    }
  }

  sendCommand(action, ml = 0, target = "None") {
    const payload = JSON.stringify({ action, ml, target });
    this.client.publish(TOPIC_PUMP_COMMANDS, payload);
    this.hardwareStatus = "busy"; // Optimistically lock the state
    console.log(`📤 Command Sent: ${payload}`);
  }
}

module.exports = MqttService;
