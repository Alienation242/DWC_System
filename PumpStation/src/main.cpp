#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ========== 1. HARDWARE MAPPING ==========
const int RELAY_PH_DOWN = 13;
const int RELAY_PH_UP   = 14;
const int RELAY_BLOOM   = 25;
const int RELAY_MICRO   = 26;
const int RELAY_WATER   = 27;

// ========== 2. NETWORK CONFIGURATION ==========
const char* ssid = "Wokwi-GUEST";
const char* password = "";
const char* mqtt_server = "test.mosquitto.org";

// This node ONLY listens to this specific topic
const char* TOPIC_COMMANDS = "kevin/dwc/pump_node_1/commands";

WiFiClient espClient;
PubSubClient client(espClient);

// ========== 3. DOSING STATE MACHINE ==========
volatile bool isDosing = false;
int activeRelayPin = -1;
unsigned long doseEndTime = 0;

// CALIBRATION: How many mL does your pump push in 1 second?
const float PUMP_ML_PER_SEC = 2.0; 

// ========== 4. THE MUTEX & PUMP LOGIC ==========
void startDosing(int pin, float ml, const char* pumpName) {
  if (isDosing) {
    Serial.println("⚠️ MUTEX LOCK: A pump is already running. Command rejected to prevent chemical crash.");
    return;
  }

  if (ml <= 0) return;

  // Calculate milliseconds needed to run the pump
  float seconds = ml / PUMP_ML_PER_SEC;
  unsigned long durationMs = (unsigned long)(seconds * 1000);

  // Lock the system and trigger the relay
  isDosing = true;
  activeRelayPin = pin;
  doseEndTime = millis() + durationMs;
  digitalWrite(activeRelayPin, HIGH);

  Serial.printf("💧 [%s] ON: Dosing %.1f mL for %lu ms\n", pumpName, ml, durationMs);
}

void checkPumpTimers() {
  // If a pump is running and its time is up, shut it down
  if (isDosing && millis() >= doseEndTime) {
    digitalWrite(activeRelayPin, LOW);
    isDosing = false;
    Serial.println("🛑 Pump OFF. System ready for next command.");
  }
}

// ========== 5. MQTT LISTENER ==========
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  // Convert payload to string
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  
  Serial.printf("📥 Command Received: %s\n", message.c_str());

  // Parse JSON (v7 format)
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, message);
  
  if (error) {
    Serial.println("❌ Failed to parse command JSON.");
    return;
  }

  const char* action = doc["action"];
  float ml = doc["ml"] | 0.0;

  // Route the command to the correct physical relay
  if (strcmp(action, "dose_ph_down") == 0) {
    startDosing(RELAY_PH_DOWN, ml, "pH Down");
  } 
  else if (strcmp(action, "dose_ph_up") == 0) {
    startDosing(RELAY_PH_UP, ml, "pH Up");
  } 
  else if (strcmp(action, "dose_bloom") == 0) {
    startDosing(RELAY_BLOOM, ml, "Bloom");
  }
  else if (strcmp(action, "dose_micro") == 0) {
    startDosing(RELAY_MICRO, ml, "Micro");
  }
  else if (strcmp(action, "dilute") == 0 || strcmp(action, "refill_water") == 0) {
    startDosing(RELAY_WATER, ml, "Fresh Water");
  }
  else {
    Serial.println("⚠️ Unknown command received.");
  }
}

// ========== 6. NETWORK MANAGER ==========
void setup_wifi() {
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  Serial.println("\n✅ Pump Node Wi-Fi connected!");
}

void reconnect() {
  while (!client.connected()) {
    if (client.connect("ESP32_PumpNode_01")) {
      Serial.println("✅ Connected to MQTT Broker!");
      client.subscribe(TOPIC_COMMANDS); 
      Serial.println("📡 Listening for Brain Commands...");
    } else {
      delay(5000);
    }
  }
}

// ========== 7. SETUP & LOOP ==========
void setup() {
  Serial.begin(115200);
  
  // Initialize pins and enforce fail-safe LOW state
  pinMode(RELAY_PH_DOWN, OUTPUT); digitalWrite(RELAY_PH_DOWN, LOW);
  pinMode(RELAY_PH_UP, OUTPUT);   digitalWrite(RELAY_PH_UP, LOW);
  pinMode(RELAY_BLOOM, OUTPUT);   digitalWrite(RELAY_BLOOM, LOW);
  pinMode(RELAY_MICRO, OUTPUT);   digitalWrite(RELAY_MICRO, LOW);
  pinMode(RELAY_WATER, OUTPUT);   digitalWrite(RELAY_WATER, LOW);

  setup_wifi();
  client.setServer(mqtt_server, 1883);
  client.setCallback(mqttCallback);
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop(); 

  // Constantly check if the active pump needs to be turned off
  checkPumpTimers();
}