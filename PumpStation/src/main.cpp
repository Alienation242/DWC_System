#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <esp_sleep.h>
#include <esp_system.h>

// ========== 0. PERSISTENT STATE (RTC memory, survives deep sleep & reset) ==========
RTC_NOINIT_ATTR uint32_t lastSeqNum;
RTC_NOINIT_ATTR float pendingDoseMl;
RTC_NOINIT_ATTR int pendingDosePin;
RTC_NOINIT_ATTR unsigned long pendingDoseDuration;
RTC_NOINIT_ATTR uint32_t pendingDoseSeq;
RTC_NOINIT_ATTR float pendingDoseRequestedMl;

// Store a completed dose that was never published (offline)
RTC_NOINIT_ATTR uint32_t completedOfflineSeq;
RTC_NOINIT_ATTR float completedOfflineVolume;

// ========== 1. HARDWARE MAPPING (100% SAFE PINS) ==========
const int RELAY_PH_DOWN   = 32;
const int RELAY_PH_UP     = 33;
const int RELAY_BLOOM     = 25;
const int RELAY_MICRO     = 26;
const int RELAY_GRO_FIN   = 27;   
const int RELAY_CALMAG    = 16;
const int RELAY_RO_WATER  = 17;   
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

String globalClientId; // Persistent MQTT ID

unsigned long wifiDisconnectTime = 0;
const unsigned long WIFI_GRACE_PERIOD_MS = 30000; 

WiFiClient espClient;
PubSubClient client(espClient);

// ========== 3. STATE MACHINE ==========
bool isSystemBusy = false;
int activeDosingPin = -1;
int activeValvePin = -1;
unsigned long actionEndTime = 0;
unsigned long lastReconnectAttempt = 0; 
unsigned long currentDoseStartTime = 0;
float currentDoseFlowRate = 20.0;
uint32_t currentDoseSeq = 0;
float currentDoseRequestedMl = 0;

float PERISTALTIC_ML_PER_SEC = 2.0;   
float SUBMERSIBLE_ML_PER_SEC = 50.0;  
const unsigned long MAX_RUNTIME_MS = 600000; 

// ========== 4. FAIL-SAFE LOGIC ==========
void emergencyStop() {
  if (activeDosingPin != -1 && actionEndTime > millis()) {
    unsigned long remaining = actionEndTime - millis();
    if (remaining > 0) {
      pendingDosePin = activeDosingPin;
      pendingDoseDuration = remaining;
      pendingDoseMl = (remaining / 1000.0) * currentDoseFlowRate; // Uses the dynamic flow rate
      pendingDoseSeq = currentDoseSeq;
      pendingDoseRequestedMl = currentDoseRequestedMl;
      Serial.printf("💾 Saved pending dose: %lu ms (%.1f ml) seq=%u\n", remaining, pendingDoseMl, pendingDoseSeq);
    }
  }
  
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
  doc["seq"] = currentDoseSeq;
  char buffer[100];
  serializeJson(doc, buffer);
  client.publish(TOPIC_STATUS, buffer);
}

void publishDoseComplete(uint32_t seq, float actualMl) {
  if (!client.connected()) {
    completedOfflineSeq = seq;
    completedOfflineVolume = actualMl;
    Serial.printf("📤 Network offline – saved completion for seq=%u (%.1f ml)\n", seq, actualMl);
    return;
  }
  
  JsonDocument doc;
  doc["status"] = "dose_complete";
  doc["seq"] = seq;
  doc["volume_ml"] = actualMl;
  char buffer[150];
  serializeJson(doc, buffer);
  client.publish(TOPIC_STATUS, buffer);
  Serial.printf("📤 Dose complete: seq=%u, vol=%.1f ml\n", seq, actualMl);
  
  if (completedOfflineSeq == seq) {
    completedOfflineSeq = 0;
    completedOfflineVolume = 0;
  }
}

void softStartSubmersible() {
  delay(200);
}

// ========== 6. FLOW SEQUENCE CONTROL ==========
void startDosing(int pin, float ml, const char* pumpName, uint32_t seq, float flowRate) {
  if (isSystemBusy) return;
  if (ml <= 0) return;
  
  lastSeqNum = seq;
  currentDoseSeq = seq;
  currentDoseRequestedMl = ml;  

  unsigned long durationMs = (unsigned long)((ml / flowRate) * 1000);
  if (durationMs > MAX_RUNTIME_MS) durationMs = MAX_RUNTIME_MS; 

  isSystemBusy = true;
  publishStatus("busy", "dosing");
  activeDosingPin = pin;
  actionEndTime = millis() + durationMs;
  currentDoseStartTime = millis();
  currentDoseFlowRate = flowRate;
  
  digitalWrite(activeDosingPin, HIGH);
  Serial.printf("[PUMP START] %s triggered: %.1f mL for %lu ms (seq=%u)\n", pumpName, ml, durationMs, seq);
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

  digitalWrite(activeValvePin, HIGH);
  delay(200);
  softStartSubmersible();
  digitalWrite(RELAY_SUB_PUMP, HIGH);

  Serial.printf("[DELIVERY] Route %s locked open. Pushing %.1f mL for %lu ms\n", target, ml, durationMs);
}

void checkTimers() {
  if (!isSystemBusy) return;

  if (millis() >= actionEndTime) {
    if (activeDosingPin != -1) {
      digitalWrite(activeDosingPin, LOW);
      unsigned long elapsed = actionEndTime - currentDoseStartTime;
      float actualMl = (elapsed / 1000.0) * currentDoseFlowRate;
      publishDoseComplete(currentDoseSeq, actualMl);
      
      activeDosingPin = -1;
      pendingDosePin = -1;
      pendingDoseDuration = 0;
      Serial.printf("✅ Dosing line closed. Actual volume: %.1f ml\n", actualMl);
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
  uint32_t seq = doc["seq"] | 0;

  // Uses proper flow rate for each distinct pump type
  if (strcmp(action, "dose_ph_down") == 0) startDosing(RELAY_PH_DOWN, ml, "pH Down", seq, PERISTALTIC_ML_PER_SEC);
  else if (strcmp(action, "dose_ph_up") == 0) startDosing(RELAY_PH_UP, ml, "pH Up", seq, PERISTALTIC_ML_PER_SEC);
  else if (strcmp(action, "dose_bloom") == 0) startDosing(RELAY_BLOOM, ml, "Bloom", seq, PERISTALTIC_ML_PER_SEC);
  else if (strcmp(action, "dose_micro") == 0) startDosing(RELAY_MICRO, ml, "Micro", seq, PERISTALTIC_ML_PER_SEC);
  else if (strcmp(action, "dose_calmag") == 0) startDosing(RELAY_CALMAG, ml, "CalMag", seq, PERISTALTIC_ML_PER_SEC);
  else if (strcmp(action, "dose_gro_fin_relay") == 0) startDosing(RELAY_GRO_FIN, ml, "Gro/Finisher", seq, PERISTALTIC_ML_PER_SEC);
  else if (strcmp(action, "dose_water") == 0) startDosing(RELAY_RO_WATER, ml, "RO Carrier Water", seq, SUBMERSIBLE_ML_PER_SEC);
  
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
  Serial.print("🔄 Attempting MQTT connection...");
  
  // Uses globalClientId mapped in setup()
  if (client.connect(globalClientId.c_str(), NULL, NULL, TOPIC_CONNECTION, 1, true, "offline")) {
    Serial.println(" ✅ Connected!");
    client.publish(TOPIC_CONNECTION, "online", true);
    client.subscribe(TOPIC_COMMANDS);

    if (completedOfflineSeq != 0 && completedOfflineVolume > 0) {
      Serial.printf("📤 Re-sending offline completion for seq=%u, vol=%.1f ml\n", completedOfflineSeq, completedOfflineVolume);
      JsonDocument doc;
      doc["status"] = "dose_complete";
      doc["seq"] = completedOfflineSeq;
      doc["volume_ml"] = completedOfflineVolume;
      char buffer[150];
      serializeJson(doc, buffer);
      client.publish(TOPIC_STATUS, buffer);
      completedOfflineSeq = 0;
      completedOfflineVolume = 0;
    }

    if (pendingDosePin != -1 && pendingDoseDuration > 0) {
      Serial.printf("🔁 Resuming paused dose after WiFi drop: pin %d for %lu ms (seq=%u)\n",
                    pendingDosePin, pendingDoseDuration, pendingDoseSeq);
      isSystemBusy = true;
      activeDosingPin = pendingDosePin;
      actionEndTime = millis() + pendingDoseDuration;
      currentDoseStartTime = millis();
      currentDoseSeq = pendingDoseSeq;
      digitalWrite(activeDosingPin, HIGH);

      publishStatus("busy", "resumed_dosing");

      pendingDosePin = -1;
      pendingDoseDuration = 0;
    }
    else if (isSystemBusy) {
      Serial.printf("📢 Reconnected while busy. Broadcasting status for seq=%u\n", currentDoseSeq);
      publishStatus("busy", "resumed_dosing");
    }
    else {
      publishStatus("idle", "none");
    }
  } else {
    Serial.print(" ❌ Failed, rc=");
    Serial.println(client.state());
  }
}

// ========== 9. EXECUTION SYSTEM ENTRY ==========
void setup() {
  Serial.begin(115200);
  randomSeed(analogRead(0));
  
  // Creates a persistent ID once per hardware boot
  globalClientId = "ESP32_Pump_" + String((uint32_t)ESP.getCpuFreqMHz(), HEX) + String(random(0xffff), HEX);

  // 1. CLEAR GARBAGE MEMORY ON COLD BOOT
  esp_reset_reason_t reason = esp_reset_reason();
  if (reason == ESP_RST_POWERON || reason == ESP_RST_BROWNOUT) {
    pendingDosePin = -1;
    pendingDoseDuration = 0;
    pendingDoseMl = 0;
    pendingDoseSeq = 0;
    completedOfflineSeq = 0;
    completedOfflineVolume = 0;
    Serial.println("🧹 Cold boot detected: Wiped random RTC memory to prevent phantom pumps.");
  }
  
  // 2. PRE-LOAD LOW STATE BEFORE ENABLING OUTPUTS
  const int allPins[] = {RELAY_PH_DOWN, RELAY_PH_UP, RELAY_BLOOM, RELAY_MICRO,
                         RELAY_GRO_FIN, RELAY_CALMAG, RELAY_RO_WATER, RELAY_SUB_PUMP,
                         RELAY_VALVE_A, RELAY_VALVE_B, RELAY_VALVE_C, RELAY_VALVE_D};
                         
  for (int pin : allPins) {
    digitalWrite(pin, LOW); // Force the pin register to LOW first
    pinMode(pin, OUTPUT);   // THEN connect the pin to the output driver
  }

  // 3. RESUME INTERRUPTED DOSE (if valid)
  if (pendingDosePin != -1 && pendingDoseDuration > 0) {
    Serial.printf("🔁 Resuming interrupted dose: pin %d for %lu ms (%.1f ml) seq=%u\n", 
                  pendingDosePin, pendingDoseDuration, pendingDoseMl, pendingDoseSeq);
    isSystemBusy = true;
    activeDosingPin = pendingDosePin;
    actionEndTime = millis() + pendingDoseDuration;
    currentDoseStartTime = millis();
    
    // Automatically inherit the correct flow rate on resume
    currentDoseFlowRate = (pendingDosePin == RELAY_RO_WATER) ? SUBMERSIBLE_ML_PER_SEC : PERISTALTIC_ML_PER_SEC;
    
    currentDoseSeq = pendingDoseSeq;
    currentDoseRequestedMl = pendingDoseRequestedMl;
    digitalWrite(activeDosingPin, HIGH);
    
    JsonDocument doc;
    doc["status"] = "busy";
    doc["task"] = "resumed_dosing";
    doc["seq"] = pendingDoseSeq; 
    char buffer[100];
    serializeJson(doc, buffer);
    client.publish(TOPIC_STATUS, buffer);

    pendingDosePin = -1;
    pendingDoseDuration = 0;
  }

  setup_wifi();
  client.setServer(mqtt_server, 1883);
  client.setCallback(mqttCallback);
  client.setKeepAlive(60);
}

void loop() {
  delay(10); // Short delay to prevent slow clockspeeds
  if (!client.connected()) {
    if (wifiDisconnectTime == 0) {
      wifiDisconnectTime = millis();
    }
    
    if (isSystemBusy && (millis() - wifiDisconnectTime > WIFI_GRACE_PERIOD_MS)) {
      Serial.println("⚠️ NETWORK CONNECTION LOST! Triggering Dead Man's Switch.");
      emergencyStop(); 
    }
    
    unsigned long now = millis();
    if (now - lastReconnectAttempt > 5000) {
      lastReconnectAttempt = now;
      if (WiFi.status() == WL_CONNECTED) reconnect(); 
    }
  } else {
    wifiDisconnectTime = 0;
    client.loop(); 
  }
  
  checkTimers(); 
}