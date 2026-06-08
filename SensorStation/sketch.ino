#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>

// --- Hardware Pins ---
const int relayPH = 25;
const int relayEC = 26;
const int sensorPH = 34;
const int sensorEC = 35;
const int pump1 = 2;
const int solenoid1 = 4;

// --- Network Setup ---
const char* ssid = "Wokwi-GUEST";
const char* password = "";
const char* mqtt_server = "test.mosquitto.org";

WiFiClient espClient;
PubSubClient client(espClient);

void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Connecting to Wi-Fi...");
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWi-Fi connected!");
}

void reconnect() {
  // Loop until we're reconnected
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    // Create a random client ID
    String clientId = "ESP32Client-";
    clientId += String(random(0xffff), HEX);
    
    // Attempt to connect
    if (client.connect(clientId.c_str())) {
      Serial.println("connected");
      // If you want the ESP32 to listen for pump commands from the PC later, 
      // you would subscribe to a command topic here:
      // client.subscribe("kevin/dwc/commands");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  
  pinMode(relayPH, OUTPUT);
  pinMode(relayEC, OUTPUT);
  pinMode(pump1, OUTPUT);
  pinMode(solenoid1, OUTPUT);
  
  digitalWrite(relayPH, LOW); 
  digitalWrite(relayEC, LOW);
  digitalWrite(pump1, LOW);
  digitalWrite(solenoid1, LOW);

  setup_wifi();
  client.setServer(mqtt_server, 1883);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop(); // Keeps the MQTT connection alive

  // --- 1. ISOLATED READINGS ---
  digitalWrite(relayPH, HIGH);
  delay(500);
  int rawPH = analogRead(sensorPH);
  digitalWrite(relayPH, LOW);
  delay(100);
  
  digitalWrite(relayEC, HIGH);
  delay(500);
  int rawEC = analogRead(sensorEC);
  digitalWrite(relayEC, LOW);
  
  // --- 2. BUILD JSON PAYLOAD ---
  String payload = "{\"rawPH\": ";
  payload += rawPH;
  payload += ", \"rawEC\": ";
  payload += rawEC;
  payload += "}";
  
  // --- 3. BROADCAST TO THE INTERNET ---
  Serial.print("Publishing to network: ");
  Serial.println(payload);
  
  // This sends the data over the Wi-Fi to the broker!
  client.publish("kevin/dwc/telemetry", payload.c_str());

  delay(2000); 
}