const mqtt = require("mqtt");

class VirtualSensorStation {
  constructor(brokerUrl = "mqtt://test.mosquitto.org", intervalMs = 2000) {
    this.client = mqtt.connect(brokerUrl);
    this.intervalMs = intervalMs;
    this.intervalId = null;
    this.currentTelemetry = {
      rawPH: 2048, // ~pH 6.5 after calibration
      rawEC: 1024, // ~500 µS/cm (250 PPM)
      isTankEmpty: false,
      isTankOverflowing: false,
    };

    this.client.on("connect", () => {
      console.log("📡 VirtualSensorStation connected to MQTT");
      this.client.publish("kevin/dwc/sensor_node_1/connection", "online");
      this.start();
    });

    this.client.on("close", () => this.stop());
  }

  start() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.publishTelemetry();
    }, this.intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  publishTelemetry() {
    const payload = {
      rawPH: this.currentTelemetry.rawPH,
      rawEC: this.currentTelemetry.rawEC,
      isTankEmpty: this.currentTelemetry.isTankEmpty,
      isTankOverflowing: this.currentTelemetry.isTankOverflowing,
    };
    const json = JSON.stringify(payload);
    this.client.publish("kevin/dwc/sensor_node_1/telemetry", json);
    console.log(
      `📤 Telemetry: pH raw=${payload.rawPH}, EC raw=${payload.rawEC}`,
    );
  }

  // Control methods for tests
  setPH(raw) {
    this.currentTelemetry.rawPH = raw;
  }
  setEC(raw) {
    this.currentTelemetry.rawEC = raw;
  }
  setTankEmpty(empty) {
    this.currentTelemetry.isTankEmpty = empty;
  }
  setTankOverflowing(overflow) {
    this.currentTelemetry.isTankOverflowing = overflow;
  }
}

module.exports = VirtualSensorStation;
