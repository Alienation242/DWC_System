#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const int SENSOR_PH_PIN = 34;
const int SENSOR_EC_PIN = 35;
const int BOTTOM_SENSOR_PIN = 33; 
const int TOP_SENSOR_PIN = 32;    

const char* ssid = "Wokwi-GUEST";
const char* password = "";
const char* mqtt_server = "test.mosquitto.org";
const char* TOPIC_TELEMETRY = "kevin/dwc/sensor_node_1/telemetry";
const char* TOPIC_CONNECTION = "kevin/dwc/sensor_node_1/connection";

WiFiClient espClient;
PubSubClient client(espClient);

unsigned long lastTelemetryTime = 0;
const long TELEMETRY_INTERVAL = 2000; // Change to 60000ms later

// ==========================================
// NEW: DEDICATED TELEMETRY FUNCTION
// ==========================================
void sendTelemetry() {
  int rawPh = analogRead(SENSOR_PH_PIN);
  int rawEc = analogRead(SENSOR_EC_PIN);

  bool isTankEmpty = (digitalRead(BOTTOM_SENSOR_PIN) == LOW);
  bool isTankOverflowing = (digitalRead(TOP_SENSOR_PIN) == HIGH);

  JsonDocument doc;
  doc["rawPH"] = rawPh;
  doc["rawEC"] = rawEc;
  doc["isTankEmpty"] = isTankEmpty;
  doc["isTankOverflowing"] = isTankOverflowing;
  
  char jsonBuffer[200];
  serializeJson(doc, jsonBuffer);

  client.publish(TOPIC_TELEMETRY, jsonBuffer);
  Serial.printf("📤 Data Sent: %s\n", jsonBuffer);
  
  // Reset the timer immediately after sending
  lastTelemetryTime = millis(); 
}

void setup_wifi() {
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  Serial.println("\n✅ Sensor Node Connected!");
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    
    if (client.connect("ESP32_SensorNode_01", NULL, NULL, TOPIC_CONNECTION, 1, true, "offline")) {
      Serial.println("Connected!");
      
      client.publish(TOPIC_CONNECTION, "online", true);
      
      sendTelemetry();
    } else {
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  
  pinMode(BOTTOM_SENSOR_PIN, INPUT);
  pinMode(TOP_SENSOR_PIN, INPUT);

  setup_wifi();
  client.setServer(mqtt_server, 1883);
}

void loop() {
  delay(10); // Short delay to prevent slow clockspeeds (wokwi documentation recommendation)
  // If connection drops, it reconnects and instantly fires telemetry again
  if (!client.connected()) reconnect();
  client.loop(); 

  // Standard interval timer
  if (millis() - lastTelemetryTime > TELEMETRY_INTERVAL) {
    sendTelemetry();
  }
}