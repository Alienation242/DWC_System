#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ========== 1. HARDWARE MAPPING ==========
const int RELAY_PH_DOWN   = 13;
const int RELAY_PH_UP     = 14;
const int RELAY_BLOOM     = 15;
const int RELAY_MICRO     = 16;
const int RELAY_GRO_FIN   = 17;   // Gro/Finisher multiplex (shared relay)
const int RELAY_CALMAG    = 25;
const int RELAY_RO_WATER  = 26;   // Fresh water
const int RELAY_SUB_PUMP  = 18;
const int RELAY_VALVE_A   = 19;
const int RELAY_VALVE_B   = 21;
const int RELAY_VALVE_C   = 22;
const int RELAY_VALVE_D   = 23;

// ========== 2. PUMP RATES (ml per second) ==========
// SET THESE TO YOUR REAL HARDWARE VALUES:
//   - Simulation (Wokwi): 20.0 ml/s (fast)
//   - Real peristaltic:  2.0 ml/s (typical)
//   - Real submersible: 50.0 ml/s (adjust)
float PERISTALTIC_ML_PER_SEC = 20.0;   // change for real hardware
float SUBMERSIBLE_ML_PER_SEC = 50.0;   // change for real hardware

const unsigned long MAX_RUNTIME_MS = 600000;   // 10 min safety (increase if needed)

// ========== 3. NETWORK ==========
const char* ssid = "Wokwi-GUEST";
const char* password = "";
const char* mqtt_server = "test.mosquitto.org";
const char* TOPIC_COMMANDS = "kevin/dwc/pump_node_1/commands";
const char* TOPIC_STATUS = "kevin/dwc/pump_node_1/status";

WiFiClient espClient;
PubSubClient client(espClient);

// ========== 4. STATE ==========
bool isSystemBusy = false;
int activeDosingPin = -1;
int activeValvePin = -1;
unsigned long actionEndTime = 0;

// ========== 5. HARDWARE LOGIC ==========
void emergencyStop() {
  const int allPins[] = {RELAY_PH_DOWN, RELAY_PH_UP, RELAY_BLOOM, RELAY_MICRO,
                         RELAY_GRO_FIN, RELAY_CALMAG, RELAY_RO_WATER, RELAY_SUB_PUMP,
                         RELAY_VALVE_A, RELAY_VALVE_B, RELAY_VALVE_C, RELAY_VALVE_D};
  for (int pin : allPins) digitalWrite(pin, LOW);
  isSystemBusy = false;
  activeDosingPin = -1;
  activeValvePin = -1;
  Serial.println("EMERGENCY STOP EXECUTED. ALL RELAYS OFF.");
}

void publishStatus(const char* state, const char* task) {
  JsonDocument doc;
  doc["status"] = state;
  doc["task"] = task;
  char buffer[100];
  serializeJson(doc, buffer);
  client.publish(TOPIC_STATUS, buffer);
}

void startDosing(int pin, float ml, const char* pumpName) {
  if (isSystemBusy) {
    Serial.println("MUTEX LOCK: System busy. Dosing rejected.");
    return;
  }
  if (ml <= 0) return;

  unsigned long durationMs = (unsigned long)((ml / PERISTALTIC_ML_PER_SEC) * 1000);
  if (durationMs > MAX_RUNTIME_MS) durationMs = MAX_RUNTIME_MS;

  isSystemBusy = true;
  publishStatus("busy", "running_pump");
  activeDosingPin = pin;
  actionEndTime = millis() + durationMs;
  digitalWrite(activeDosingPin, HIGH);

  Serial.printf("[DOSING] %s ON: %.1f mL for %lu ms\n", pumpName, ml, durationMs);
}

void startDelivery(const char* target, float ml) {
  if (isSystemBusy) {
    Serial.println("⚠️ MUTEX LOCK: System busy. Delivery rejected.");
    return;
  }
  if (ml <= 0) return;

  if (strcmp(target, "A") == 0) activeValvePin = RELAY_VALVE_A;
  else if (strcmp(target, "B") == 0) activeValvePin = RELAY_VALVE_B;
  else if (strcmp(target, "C") == 0) activeValvePin = RELAY_VALVE_C;
  else if (strcmp(target, "D") == 0) activeValvePin = RELAY_VALVE_D;
  else {
    Serial.println("❌ Invalid target pot specified.");
    return;
  }

  unsigned long durationMs = (unsigned long)((ml / SUBMERSIBLE_ML_PER_SEC) * 1000);
  if (durationMs > MAX_RUNTIME_MS) durationMs = MAX_RUNTIME_MS;

  isSystemBusy = true;
  publishStatus("busy", "running_pump");
  actionEndTime = millis() + durationMs;

  digitalWrite(activeValvePin, HIGH);
  delay(150);
  digitalWrite(RELAY_SUB_PUMP, HIGH);

  Serial.printf("[DELIVERY] Routing %lu mL to Pot %s for %lu ms\n", (unsigned long)ml, target, durationMs);
}

void checkTimers() {
  if (!isSystemBusy) return;

  if (millis() >= actionEndTime) {
    if (activeDosingPin != -1) {
      digitalWrite(activeDosingPin, LOW);
      activeDosingPin = -1;
      Serial.println("✅ Dosing complete.");
    }

    if (activeValvePin != -1) {
      digitalWrite(RELAY_SUB_PUMP, LOW);
      delay(150);
      digitalWrite(activeValvePin, LOW);
      activeValvePin = -1;
      Serial.println("✅ Delivery complete.");
    }

    isSystemBusy = false;
    publishStatus("idle", "none");
  }
}

// ========== 6. MQTT CALLBACK ==========
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];

  JsonDocument doc;
  if (deserializeJson(doc, message)) {
    Serial.println("Failed to parse JSON command.");
    return;
  }

  const char* action = doc["action"];
  float ml = doc["ml"] | 0.0;

  if (strcmp(action, "dose_ph_down") == 0) startDosing(RELAY_PH_DOWN, ml, "pH Down");
  else if (strcmp(action, "dose_ph_up") == 0) startDosing(RELAY_PH_UP, ml, "pH Up");
  else if (strcmp(action, "dose_bloom") == 0) startDosing(RELAY_BLOOM, ml, "Bloom");
  else if (strcmp(action, "dose_micro") == 0) startDosing(RELAY_MICRO, ml, "Micro");
  else if (strcmp(action, "dose_calmag") == 0) startDosing(RELAY_CALMAG, ml, "CalMag");
  else if (strcmp(action, "dose_gro_fin_relay") == 0) startDosing(RELAY_GRO_FIN, ml, "Gro/Finisher");
  else if (strcmp(action, "dose_water") == 0) startDosing(RELAY_RO_WATER, ml, "Water");
  else if (strcmp(action, "deliver") == 0) {
    const char* target = doc["target"] | "Unknown";
    startDelivery(target, ml);
  }
  else if (strcmp(action, "stop") == 0) emergencyStop();
}

// ========== 7. SETUP & LOOP ==========
void setup_wifi() {
  Serial.print("\nConnecting to Wi-Fi");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nPump Node Connected!");
}

void setup() {
  Serial.begin(115200);

  const int allPins[] = {RELAY_PH_DOWN, RELAY_PH_UP, RELAY_BLOOM, RELAY_MICRO,
                         RELAY_GRO_FIN, RELAY_CALMAG, RELAY_RO_WATER, RELAY_SUB_PUMP,
                         RELAY_VALVE_A, RELAY_VALVE_B, RELAY_VALVE_C, RELAY_VALVE_D};
  for (int pin : allPins) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  }

  setup_wifi();
  client.setServer(mqtt_server, 1883);
  client.setCallback(mqttCallback);
}

void loop() {
  // 1. Always check hardware timers FIRST – critical for safety
  checkTimers();

  // 2. Non‑blocking MQTT connection management
  if (!client.connected()) {
    if (client.connect("ESP32_PumpNode_01")) {
      client.subscribe(TOPIC_COMMANDS);
      Serial.println("Listening for Brain Commands...");
    } else {
      delay(100);   // short backoff, allows checkTimers() to run
    }
  } else {
    client.loop();
  }
}