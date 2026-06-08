const mqtt = require("mqtt");
const client = mqtt.connect("mqtt://test.mosquitto.org");

// 1. Decoupled Network Routing
const SENSOR_TOPIC = "kevin/dwc/sensor_node_1/telemetry";
const PUMP_TOPIC = "kevin/dwc/pump_node_1/commands";

client.on("connect", () => {
  console.log("✅ Brain Server Online & Connected to MQTT");
  client.subscribe(SENSOR_TOPIC, (err) => {
    if (!err) console.log(`📡 Listening for telemetry on: ${SENSOR_TOPIC}`);
  });
});

client.on("message", (topic, message) => {
  if (topic === SENSOR_TOPIC) {
    try {
      const data = JSON.parse(message.toString());

      // 2. Catch the raw values
      const rawPH = data.rawPH;
      const rawEC = data.rawEC;
      const isTankEmpty = data.isTankEmpty;
      const isTankOverflowing = data.isTankOverflowing;

      // 3. Convert raw signals to real-world units
      const pH = (rawPH / 4095) * 14.0;
      const EC = (rawEC / 4095) * 2500;

      console.log("\n--- SYSTEM TELEMETRY ---");
      console.log(`pH: ${pH.toFixed(2)}    EC: ${Math.round(EC)} µS/cm`);
      console.log(
        `Water Level: ${isTankEmpty ? "CRITICAL LOW" : isTankOverflowing ? "OVERFLOW DANGER" : "Normal"}`,
      );

      // HARDWARE SAFETY INTERLOCK
      if (isTankEmpty) {
        console.log(
          "SAFETY TRIGGER: Tank is empty! Dosing suspended. Command refill.",
        );
        client.publish(
          PUMP_TOPIC,
          JSON.stringify({ action: "refill_water", ml: 1000 }),
        );
        return;
      }
      if (isTankOverflowing) {
        console.log("SAFETY TRIGGER: Tank overflow risk! Halting all pumps.");
        return;
      }

      // 5. AUTOMATED CONTROL LOGIC (EC First, pH Second)
      const PH_TARGET = 5.8;
      const PH_DEADBAND = 0.2;
      const EC_TARGET = 1200;
      const EC_DEADBAND = 100;

      if (EC < EC_TARGET - EC_DEADBAND) {
        console.log("  → EC too low, commanding Bloom pump");
        client.publish(
          PUMP_TOPIC,
          JSON.stringify({ action: "dose_bloom", ml: 10 }),
        );
      } else if (EC > EC_TARGET + EC_DEADBAND) {
        console.log("  → EC too high, commanding fresh water dilution");
        client.publish(
          PUMP_TOPIC,
          JSON.stringify({ action: "dilute", ml: 200 }),
        );
      }
      // Only adjust pH if EC is perfectly inside the deadband
      else if (pH > PH_TARGET + PH_DEADBAND) {
        console.log("  → pH too high, commanding pH Down pump");
        client.publish(
          PUMP_TOPIC,
          JSON.stringify({ action: "dose_ph_down", ml: 5 }),
        );
      } else if (pH < PH_TARGET - PH_DEADBAND) {
        console.log("  → pH too low, commanding pH Up pump");
        client.publish(
          PUMP_TOPIC,
          JSON.stringify({ action: "dose_ph_up", ml: 5 }),
        );
      } else {
        console.log("  → System Perfectly Balanced");
      }
    } catch (err) {
      console.error("Parse error:", err.message);
    }
  }
});
