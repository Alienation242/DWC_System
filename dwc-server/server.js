const mqtt = require("mqtt");
const client = mqtt.connect("mqtt://test.mosquitto.org");

const PUMP_TOPIC = "kevin/dwc/pump_node_1/commands";
const PUMP_STATUS_TOPIC = "kevin/dwc/pump_node_1/status";
const SENSOR_WILDCARD = "kevin/dwc/+/telemetry";

// --- THE BRAIN'S STATE MACHINE ---
let hardwareStatus = "idle"; // Tracks the physical pump station ("idle" or "busy")
let currentBatchStep = 0; // 0=None, 1=Filling, 2=Delivering
let activeTargetPot = null;

client.on("connect", () => {
  console.log("✅ Brain Server Online & Listening");
  client.subscribe(SENSOR_WILDCARD);
  client.subscribe(PUMP_STATUS_TOPIC); // NEW: Listening to the muscle!
});

client.on("message", (topic, message) => {
  try {
    const data = JSON.parse(message.toString());

    // ==========================================
    // 1. LISTEN TO THE PUMP STATION (Hardware Feedback)
    // ==========================================
    if (topic === PUMP_STATUS_TOPIC) {
      hardwareStatus = data.status;

      // If the hardware just finished a job and became idle, trigger the next step!
      if (hardwareStatus === "idle" && activeTargetPot !== null) {
        if (currentBatchStep === 1) {
          console.log(`\n✅ [Seq 1 Complete] 5L Tank is Full.`);
          console.log(
            `🌊 [Seq 2] Routing 5L Batch to Pot ${activeTargetPot}...`,
          );
          currentBatchStep = 2;
          client.publish(
            PUMP_TOPIC,
            JSON.stringify({
              action: "deliver",
              target: activeTargetPot,
              ml: 5000,
            }),
          );
        } else if (currentBatchStep === 2) {
          console.log(
            `\n✅ [Seq 2 Complete] Delivery to Pot ${activeTargetPot} finished.`,
          );
          console.log(`🌿 BATCH PROCESS COMPLETE. Manifold is now free.`);
          // Reset the state machine
          currentBatchStep = 0;
          activeTargetPot = null;
        }
      }
      return; // Stop processing this message
    }

    // ==========================================
    // 2. LISTEN TO THE POTS (Sensor Telemetry)
    // ==========================================
    if (topic.includes("telemetry")) {
      const topicParts = topic.split("/");
      const reportingNode = topicParts[2];
      const potLetter = reportingNode.split("_").pop().toUpperCase();

      // If the manifold is busy doing a batch, IGNORE all other telemetry requests
      if (currentBatchStep !== 0) return;

      // Start a new sequence ONLY if the hardware is idle and we aren't currently in a sequence
      if (data.isTankEmpty && hardwareStatus === "idle") {
        console.log(
          `\n⚠️ Pot ${potLetter} is EMPTY. Reserving Manifold and starting Batch Process!`,
        );

        activeTargetPot = potLetter;
        currentBatchStep = 1;

        console.log(`💧 [Seq 1] Filling 5L Mixing Tank with fresh water...`);
        client.publish(
          PUMP_TOPIC,
          JSON.stringify({ action: "fill_tank", ml: 5000 }),
        );
      }
    }
  } catch (err) {
    console.error("Parse error:", err.message);
  }
});
