const mqtt = require("mqtt");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const MQTT_BROKER = "mqtt://test.mosquitto.org";
const TOPIC_TELEMETRY = "kevin/dwc/sensor_node_1/telemetry";
const CalibrationService = require("./calibrationService");

// Same calibration as recipeEngine (keep in sync)
const CALIBRATION = {
  pH: { rawLow: 1093, realLow: 4.0, rawHigh: 1973, realHigh: 7.0 },
  EC: { rawLow: 1305, realLow: 0.0, rawHigh: 2110, realHigh: 1000.0 },
};

function mapValue(x, in_min, in_max, out_min, out_max) {
  return ((x - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;
}

class MqttService {
  constructor(io) {
    this.io = io;
    this.client = mqtt.connect(MQTT_BROKER);

    this.client.on("connect", () => {
      console.log("Connected to MQTT Broker");
      this.client.subscribe(TOPIC_TELEMETRY, (err) => {
        if (!err) console.log(`📡 Subscribed to: ${TOPIC_TELEMETRY}`);
      });
    });

    this.client.on("message", async (topic, message) => {
      if (topic === TOPIC_TELEMETRY) {
        await this.handleTelemetry(message);
      }
    });
  }

  async handleTelemetry(message) {
    try {
      const payload = JSON.parse(message.toString());
      const realPH = await CalibrationService.convertPH(payload.rawPH);
      const realEC = await CalibrationService.convertEC(payload.rawEC);

      const log = await prisma.telemetryLog.create({
        data: {
          rawPH: payload.rawPH,
          rawEC: payload.rawEC,
          realPH: realPH, // add this field to schema
          realEC: realEC, // add this field to schema
          isTankEmpty: payload.isTankEmpty || false,
          isTankOverflowing: payload.isTankOverflowing || false,
        },
      });

      console.log(
        `Telemetry Logged: pH ${realPH.toFixed(2)} | EC ${realEC.toFixed(0)} PPM`,
      );

      // Emit real values via WebSocket (dashboard can use these)
      if (this.io) {
        this.io.emit("telemetry_update", {
          ...payload,
          realPH,
          realEC,
        });
      }
    } catch (error) {
      console.error("Failed to process telemetry:", error.message);
    }
  }

  sendCommand(action, ml = 0, target = "None") {
    const payload = JSON.stringify({ action, ml, target });
    this.client.publish("kevin/dwc/pump_node_1/commands", payload);
    console.log(`📤 Command Sent: ${payload}`);
  }
}

module.exports = MqttService;
