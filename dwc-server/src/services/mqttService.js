const mqtt = require("mqtt");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const MQTT_BROKER = "mqtt://test.mosquitto.org";
const TOPIC_TELEMETRY = "kevin/dwc/sensor_node_1/telemetry";

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

      const log = await prisma.telemetryLog.create({
        data: {
          rawPH: payload.rawPH,
          rawEC: payload.rawEC,
          isTankEmpty: payload.isTankEmpty || false,
          isTankOverflowing: payload.isTankOverflowing || false,
        },
      });

      console.log(`Telemetry Logged: pH ${log.rawPH} | EC ${log.rawEC}`);

      if (this.io) {
        this.io.emit("telemetry_update", payload);
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
