const mqtt = require("mqtt");

class VirtualPump {
  constructor(brokerUrl = "mqtt://test.mosquitto.org") {
    this.client = mqtt.connect(brokerUrl);
    this.status = "idle";
    this.currentSeq = 0;
    this.pumpTimer = null;

    this.client.on("connect", () => {
      this.client.subscribe("kevin/dwc/pump_node_1/commands");
      this.client.publish("kevin/dwc/pump_node_1/connection", "online");
    });

    this.client.on("message", (topic, message) => {
      const payload = JSON.parse(message.toString());
      if (topic === "kevin/dwc/pump_node_1/commands") {
        this.handleCommand(payload);
      }
    });
  }

  handleCommand(payload) {
    if (payload.action.startsWith("dose_") || payload.action === "deliver") {
      this.currentSeq = payload.seq;
      this.status = "busy";

      // Tell the server we started
      this.emitStatus("busy", "dosing");

      // Calculate how long to pump (using peristaltic 20ml/s for this mock)
      const durationMs = (payload.ml / 20.0) * 1000;

      this.pumpTimer = setTimeout(() => {
        this.status = "idle";
        this.emitComplete(payload.ml);
        this.emitStatus("idle", "none");
      }, durationMs);
    }

    if (payload.action === "stop") {
      clearTimeout(this.pumpTimer);
      this.status = "idle";
      this.emitStatus("idle", "none");
    }
  }

  emitStatus(status, task) {
    this.client.publish(
      "kevin/dwc/pump_node_1/status",
      JSON.stringify({
        status: status,
        task: task,
        seq: this.currentSeq,
      }),
    );
  }

  emitComplete(ml) {
    this.client.publish(
      "kevin/dwc/pump_node_1/status",
      JSON.stringify({
        status: "dose_complete",
        seq: this.currentSeq,
        volume_ml: ml,
      }),
    );
  }

  // === EDGE CASE SIMULATORS ===

  simulateWifiDrop(durationMs) {
    // Send LWT offline
    this.client.publish("kevin/dwc/pump_node_1/connection", "offline");

    setTimeout(() => {
      // Reconnect and broadcast resume!
      this.client.publish("kevin/dwc/pump_node_1/connection", "online");
      if (this.status === "busy") {
        this.emitStatus("busy", "resumed_dosing");
      }
    }, durationMs);
  }

  simulatePowerCrash() {
    clearTimeout(this.pumpTimer); // Pump physically stops
    this.status = "idle";
    this.client.publish("kevin/dwc/pump_node_1/connection", "offline");
    // Will not auto-resume upon calling connect()
  }
}

module.exports = VirtualPump;
