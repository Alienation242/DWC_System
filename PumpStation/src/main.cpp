#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ========== 1. HARDWARE MAPPING ==========
const int RELAY_PH_DOWN   = 13;
const int RELAY_PH_UP     = 14;
const int RELAY_BLOOM     = 15;
const int RELAY_MICRO     = 16;
const int RELAY_GRO_FIN   = 17;   
const int RELAY_CALMAG    = 25;
const int RELAY_RO_WATER  = 26;   
const int RELAY_SUB_PUMP  = 18;
const int RELAY_VALVE_A   = 19;
const int RELAY_VALVE_B   = 21;
const int RELAY_VALVE_C   = 22;
const int RELAY_VALVE_D   = 23;

// ========== 2. NETWORK CONFIGURATION ==========
const char* ssid = "Wokwi-GUEST";               
const char* password = "";
const char* mqtt_server = "test.mosquitto.org";  

const char* TOPIC_COMMANDS   = "kevin/dwc/pump_node_1/commands";
const char* TOPIC_STATUS     = "kevin/dwc/pump_node_1/status";
const char* TOPIC_CONNECTION = "kevin/dwc/pump_node_1/connection"; 

WiFiClient espClient;
PubSubClient client(espClient);

// ========== 3. STATE MACHINE ==========
bool isSystemBusy = false;
int activeDosingPin = -1;
int activeValvePin = -1;
unsigned long actionEndTime = 0;
unsigned long lastReconnectAttempt = 0; 

float PERISTALTIC_ML_PER_SEC = 20.0;   
float SUBMERSIBLE_ML_PER_SEC = 50.0;  
const unsigned long MAX_RUNTIME_MS = 600000; 

// ========== 4. FAIL-SAFE LOGIC ==========
void emergencyStop() {
  const int allPins[] = {RELAY_PH_DOWN, RELAY_PH_UP, RELAY_BLOOM, RELAY_MICRO,
                         RELAY_GRO_FIN, RELAY_CALMAG, RELAY_RO_WATER, RELAY_SUB_PUMP,
                         RELAY_VALVE_A, RELAY_VALVE_B, RELAY_VALVE_C, RELAY_VALVE_D};
  for (int pin : allPins) {
    digitalWrite(pin, LOW);
  }
  isSystemBusy = false;
  activeDosingPin = -1;
  activeValvePin = -1;
  Serial.println("🚨 EMERGENCY STOP EXECUTED. ALL RELAYS OFF.");
}

void publishStatus(const char* state, const char* task) {
  JsonDocument doc;
  doc["status"] = state;
  doc["task"] = task;
  char buffer[100];
  serializeJson(doc, buffer);
  client.publish(TOPIC_STATUS, buffer);
}

// ========== 5. SOFT-START FOR SUBMERSIBLE PUMP ==========
void softStartSubmersible() {
  // Gradually increase PWM duty cycle over 500ms to reduce inrush current
  // Note: This requires the pump to be connected to a PWM-capable pin (e.g., LEDC).
  // If using a simple relay, this function does nothing – but you can still add a delay.
  // For a relay, we just add a small delay to let the valve fully open.
  delay(200); // Allow valve to stabilise
  // If you replace the relay with a MOSFET, uncomment the following:
  /*
  for (int duty = 0; duty <= 255; duty += 51) {
    ledcWrite(0, duty); // Use LEDC channel 0
    delay(50);
  }
  */
}

// ========== 6. FLOW SEQUENCE CONTROL ==========
void startDosing(int pin, float ml, const char* pumpName) {
  if (isSystemBusy) return;
  if (ml <= 0) return;

  unsigned long durationMs = (unsigned long)((ml / PERISTALTIC_ML_PER_SEC) * 1000);
  if (durationMs > MAX_RUNTIME_MS) durationMs = MAX_RUNTIME_MS; 

  isSystemBusy = true;
  publishStatus("busy", "dosing");
  activeDosingPin = pin;
  actionEndTime = millis() + durationMs;
  
  digitalWrite(activeDosingPin, HIGH);
  Serial.printf("[PUMP START] %s triggered: %.1f mL for %lu ms\n", pumpName, ml, durationMs);
}

void startDelivery(const char* target, float ml) {
  if (isSystemBusy) return;
  if (ml <= 0) return;

  if (strcmp(target, "A") == 0) activeValvePin = RELAY_VALVE_A;
  else if (strcmp(target, "B") == 0) activeValvePin = RELAY_VALVE_B;
  else if (strcmp(target, "C") == 0) activeValvePin = RELAY_VALVE_C;
  else if (strcmp(target, "D") == 0) activeValvePin = RELAY_VALVE_D;
  else return;

  unsigned long durationMs = (unsigned long)((ml / SUBMERSIBLE_ML_PER_SEC) * 1000);
  if (durationMs > MAX_RUNTIME_MS) durationMs = MAX_RUNTIME_MS;

  isSystemBusy = true;
  publishStatus("busy", "delivering");
  actionEndTime = millis() + durationMs;

  // Open the valve first
  digitalWrite(activeValvePin, HIGH);
  delay(200); // Stagger: let valve settle before starting pump

  // Start submersible pump with soft-start
  softStartSubmersible();
  digitalWrite(RELAY_SUB_PUMP, HIGH);

  Serial.printf("[DELIVERY] Route %s locked open. Pushing %.1f mL for %lu ms\n", target, ml, durationMs);
}

void checkTimers() {
  if (!isSystemBusy) return;

  if (millis() >= actionEndTime) {
    if (activeDosingPin != -1) {
      digitalWrite(activeDosingPin, LOW);
      activeDosingPin = -1;
      Serial.println("✅ Dosing line safely closed.");
    }
    
    if (activeValvePin != -1) {
      digitalWrite(RELAY_SUB_PUMP, LOW);
      delay(150); 
      digitalWrite(activeValvePin, LOW);
      activeValvePin = -1;
      Serial.println("✅ Delivery system fully cleared.");
    }

    isSystemBusy = false;
    publishStatus("idle", "none");
  }
}

// ========== 7. MQTT COMMAND PARSER ==========
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];
  
  JsonDocument doc;
  if (deserializeJson(doc, message)) return;

  const char* action = doc["action"];
  float ml = doc["ml"] | 0.0;

  if (strcmp(action, "dose_ph_down") == 0) startDosing(RELAY_PH_DOWN, ml, "pH Down");
  else if (strcmp(action, "dose_ph_up") == 0) startDosing(RELAY_PH_UP, ml, "pH Up");
  else if (strcmp(action, "dose_bloom") == 0) startDosing(RELAY_BLOOM, ml, "Bloom");
  else if (strcmp(action, "dose_micro") == 0) startDosing(RELAY_MICRO, ml, "Micro");
  else if (strcmp(action, "dose_calmag") == 0) startDosing(RELAY_CALMAG, ml, "CalMag"); 
  else if (strcmp(action, "dose_gro_fin_relay") == 0) startDosing(RELAY_GRO_FIN, ml, "Gro/Finisher"); 
  else if (strcmp(action, "dose_water") == 0) startDosing(RELAY_RO_WATER, ml, "RO Carrier Water"); 
  else if (strcmp(action, "deliver") == 0) {
    const char* target = doc["target"] | "Unknown";
    startDelivery(target, ml);
  }
  else if (strcmp(action, "stop") == 0) emergencyStop();
}

// ========== 8. NETWORK LAYER ==========
void setup_wifi() {
  Serial.print("\n📶 Initializing Wi-Fi");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" ✅ Wi-Fi connected");
}

void reconnect() {
  String clientId = "ESP32_Pump_" + String(random(0xffff), HEX);
  Serial.print("🔄 Attempting MQTT connection...");
  
  if (client.connect(clientId.c_str(), NULL, NULL, TOPIC_CONNECTION, 1, true, "offline")) {
    Serial.println(" ✅ Connected!");
    client.publish(TOPIC_CONNECTION, "online", true);
    client.subscribe(TOPIC_COMMANDS);
    if (!isSystemBusy) publishStatus("idle", "none");
  } else {
    Serial.print(" ❌ Failed, rc=");
    Serial.println(client.state());
  }
}

// ========== 9. EXECUTION SYSTEM ENTRY ==========
void setup() {
  Serial.begin(115200);
  randomSeed(analogRead(0));
  
  const int allPins[] = {RELAY_PH_DOWN, RELAY_PH_UP, RELAY_BLOOM, RELAY_MICRO,
                         RELAY_GRO_FIN, RELAY_CALMAG, RELAY_RO_WATER, RELAY_SUB_PUMP,
                         RELAY_VALVE_A, RELAY_VALVE_B, RELAY_VALVE_C, RELAY_VALVE_D};
  for (int pin : allPins) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW); 
  }

  // Optional: set up LEDC PWM for soft-start if using MOSFET
  // ledcSetup(0, 5000, 8); // channel 0, 5kHz, 8-bit resolution
  // ledcAttachPin(RELAY_SUB_PUMP, 0);

  setup_wifi();
  client.setServer(mqtt_server, 1883);
  client.setCallback(mqttCallback);
  client.setKeepAlive(60); // Increase keep-alive to reduce disconnections
}

void loop() {
  if (!client.connected()) {
    if (isSystemBusy) {
      Serial.println("⚠️ NETWORK CONNECTION LOST! Triggering Dead Man's Switch.");
      emergencyStop(); 
    }

    unsigned long now = millis();
    if (now - lastReconnectAttempt > 5000) {
      lastReconnectAttempt = now;
      if (WiFi.status() == WL_CONNECTED) reconnect(); 
    }
  } else {
    client.loop(); 
  }
  checkTimers(); 
}