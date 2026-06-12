# DWC_System – Fully Autonomous Deep Water Culture Controller

A complete, ready‑to‑deploy **Deep Water Culture (DWC)** hydroponic system that monitors pH/EC, meters nutrients and pH adjusters, and maintains a perfect reservoir environment. The system is split into three independent components that communicate via MQTT, enabling remote monitoring and control from a web dashboard.

**Key features**

- Real‑time pH and EC telemetry (ESP32 + analog probes)
- Automated dosing of up to 7 nutrient/pH liquids (peristaltic pumps)
- Precision mixing tank and pressure‑delivery (submersible pump + solenoid valves)
- Watchdog safety (daily limits, cooldown periods, offline detection, power‑loss recovery via RTC memory)
- Web dashboard (Socket.io) for monitoring and manual overrides (frontend not included – build your own)
- Fully configurable strain recipes (PPFD‑based EC boost up to +150 ppm, phase scheduling)
- Simulated with **Wokwi** – ready for real‑world deployment

---

## Architecture Overview

    [ Sensor Station (ESP32) ]  --MQTT-->  [ MQTT Broker (mosquitto) ]  <--MQTT-->  [ Pump Station (ESP32) ]
                                                     ^
                                                     |
                                              [ Node.js Server ]
                                                     |
                                              [ Web Dashboard (your own) ]

- **Sensor Station** – Reads pH/EC, tank level switches, publishes telemetry every 2 seconds.
- **Pump Station** – Listens for dosing commands, runs pumps, handles emergency stops, persists interrupted doses in RTC memory (survives power loss).
- **Node.js Server** – Orchestrates everything: stores telemetry in SQLite, runs the **Recipe Engine**, exposes REST API, enforces watchdog limits, emits Socket.io events.
- **MQTT Broker** – Tested with `test.mosquitto.org`; replace with your own broker in production.

---

## Hardware Components

### Sensor Station

| Component                     | ESP32 pin |
| ----------------------------- | --------- |
| pH probe (analog)             | 34        |
| EC probe (analog)             | 35        |
| Tank empty switch (bottom)    | 33        |
| Tank overflowing switch (top) | 32        |

**Power:** 5V via USB (ESP32). Probes are 0‑3.3V compatible.

### Pump Station (12V system, opto‑isolated relays)

| Device                 | Relay    | ESP32 pin |
| ---------------------- | -------- | --------- |
| pH Down (peristaltic)  | Relay 1  | 13        |
| pH Up (peristaltic)    | Relay 2  | 14        |
| Bloom                  | Relay 3  | 15        |
| Micro                  | Relay 4  | 16        |
| Gro / Finisher         | Relay 5  | 17        |
| CalMag                 | Relay 6  | 25        |
| RO Water               | Relay 7  | 26        |
| Submersible pump       | Relay 8  | 18        |
| Valve A (pot selector) | Relay 9  | 19        |
| Valve B                | Relay 10 | 21        |

**Important**:

- Use a separate 12V power supply for relay coils.
- **Remove JD‑VCC jumpers** and feed relay coil power from the 12V supply (not from the ESP).
- Do NOT connect ESP GND to relay GND – the optocouplers isolate the ESP.
- Add a flyback diode across each pump/valve coil to suppress voltage spikes.

---

## Software Components

### Node.js Server (`dwc-server/`)

- **Express** REST API (calibration, nutrient profile, watchdog config, system state)
- **Socket.io** – emits `telemetry_update` and `network_update` events (consume them in your dashboard)
- **Prisma ORM** (SQLite database – stores telemetry, dose logs, system state)
- **RecipeEngine** – core intelligence:
  - Loads strain profile (e.g. `default.json`) with week‑by‑week ppm targets.
  - Dynamically adjusts target EC based on live PPFD (light intensity) – max boost +150 ppm.
  - Calculates nutrient deficit and schedules mixing/delivery batches.
  - Handles pH correction (proportional dosing, up to 5 ml per tick).
  - Implements retry logic, offline recovery, and overflow shield (deducts assumed pumped volume).
- **Watchdog** – per‑pump daily limits, cooldown periods, water as unlimited safe resource. Configurable via API.
- **MQTT Service** – subscribes to telemetry and pump status, publishes commands, tracks device online/offline.

### Firmware (`PumpStation/`, `SensorStation/`)

- Written in **Arduino/C++** (PlatformIO).
- `SensorStation`: reads probes and switches, publishes telemetry every 2 seconds (configurable).
- `PumpStation`:
  - Parses JSON commands (`dose_...`, `deliver`, `stop`).
  - Calculates runtime using flow rates from `hardware.json` (default: 2 mL/s peristaltic, 50 mL/s submersible).
  - Persists interrupted doses in RTC memory – survives deep sleep or power loss, resumes after reboot.
  - Dead‑man’s switch: triggers emergency stop if network disappears for 30 seconds while busy.
  - Saves `dose_complete` messages when offline and replays them after reconnection.

---

## Configuration Files (`dwc-server/config/`)

| File                    | Purpose                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `calibration.json`      | raw ADC → real pH/EC mapping (linear). Update after two‑point calibration.                              |
| `hardware.json`         | peristaltic/submersible flow rates (mL/s) – must match pump station firmware.                           |
| `nutrient_profile.json` | brand name, carrier fluid volume, mixing sequence (e.g. `["CalMag","Micro","Gro","Bloom","Finisher"]`). |
| `system.json`           | EC deadbands, pH deadband, max batch volume, watchdog defaults.                                         |

**Example hardware.json (real hardware)**

    {
      "peristaltic_ml_per_sec": 2.0,
      "submersible_ml_per_sec": 50.0,
      "safety_buffer_ms": 30000
    }

**Example strain recipe (`src/recipes/default.json`)** – defines `flipWeek`, `stretchWks`, `bulkWks`, `ripenWks`, and per‑phase PPFD/temperature/humidity/PPM curves. You can add more recipes and change `currentProfilePath` in the database.

---

## Setup Instructions

### 1. Prerequisites

- Node.js 20+ and npm
- PlatformIO CLI (or VS Code with PlatformIO extension)
- MQTT broker (local or public; default `test.mosquitto.org` works for testing)
- (Optional) Wokwi account for simulation

### 2. Clone & install server dependencies

    git clone https://github.com/Alienation242/DWC_System.git
    cd DWC_System/dwc-server
    npm install
    npx prisma db push   # creates SQLite database

### 3. Configure MQTT broker

Edit `src/services/mqttService.js` and `src/services/recipeEngine.js` if you change the broker URL or topics.  
Default topics:

- Telemetry: `kevin/dwc/sensor_node_1/telemetry`
- Pump commands: `kevin/dwc/pump_node_1/commands`
- Pump status: `kevin/dwc/pump_node_1/status`
- Connection status: `kevin/dwc/+/connection`

### 4. Flash the ESP32 firmwares

**Sensor Station** (inside `SensorStation/`)

    pio run --target upload

**Pump Station** (inside `PumpStation/`)

    pio run --target upload

**Wokwi simulation** – open the project in [Wokwi](https://wokwi.com) and use the provided `diagram.json` + `wokwi.toml`.

### 5. Start the server

    npm run dev          # development with auto‑restart
    # or
    npm start            # production

The server listens on port 3000. To see telemetry, you need a dashboard that connects via Socket.io – build your own or use the raw REST API.

---

## Running the System (Real Hardware)

1. Power the ESP32s and the 12V relay supply.
2. Ensure both stations are on the same WiFi as the server and broker.
3. Start the Node.js server.
4. The server will automatically seed the database (SystemState, WatchdogConfigs) on first run.
5. Telemetry will appear in the console logs; the Recipe Engine will begin dosing when conditions require.

**Manual overrides** – use the REST API endpoints (see below) or send MQTT commands directly (e.g., `stop`).

---

## Testing

The server includes a comprehensive Jest test suite (unit + integration). Coverage is ~87%.

    cd dwc-server
    npm run test          # run all tests
    npm run test:coverage # generate coverage report

**Key test files**

- `tests/unit/services/recipeEngine/` – logic tests (math, profile resolution, executeTick)
- `tests/integration/` – watchdog, hardware recovery scenarios (simulated via MockMqttService)
- `tests/unit/server/api.test.js` – REST API endpoints

The firmware can be tested in Wokwi by uploading the compiled binaries (`firmware.bin`) and running the simulation.

---

## API Endpoints (Server)

| Method | Endpoint                  | Description                                           |
| ------ | ------------------------- | ----------------------------------------------------- |
| GET    | `/api/status`             | Server health and device registry                     |
| GET    | `/api/calibration`        | Get pH/EC calibration                                 |
| POST   | `/api/calibration`        | Update calibration                                    |
| GET    | `/api/nutrient-config`    | Get nutrient profile                                  |
| POST   | `/api/nutrient-config`    | Update nutrient profile                               |
| GET    | `/api/watchdog/config`    | List all pump watchdog configs                        |
| POST   | `/api/watchdog/config`    | Upsert a watchdog config                              |
| GET    | `/api/system/state`       | Get current day, strain, sysVol, etc.                 |
| POST   | `/api/system/advance-day` | Increment grow day (used by UI)                       |
| POST   | `/api/system/override`    | Set automation mode (`AUTOMATED` / `MANUAL_OVERRIDE`) |

All responses are JSON.

---

## Calibration (pH and EC)

1. Prepare two buffer solutions (e.g., pH 4.0 and 7.0; EC 0 µS/cm and 1413 µS/cm).
2. Read the raw ADC values from the sensor node (monitor serial output).
3. Update `config/calibration.json` with the low and high raw/real pairs.
4. Restart the server or call `POST /api/calibration` with the new values.

Example calibration for pH:

    {
      "pH": {
        "rawLow": 512,
        "realLow": 4.0,
        "rawHigh": 3072,
        "realHigh": 7.0
      }
    }

---

## Watchdog Configuration

The server enforces per‑pump daily limits and cooldown periods. Defaults are set in `system.json`. You can change them at runtime via the API:

    POST /api/watchdog/config
    {
      "pumpName": "Micro",
      "dailyLimitMl": 15.0,
      "cooldownSecs": 30,
      "enabled": true
    }

Water is always allowed (no limit). The watchdog automatically creates a config for any new pump name the first time it is used.

---

## Troubleshooting

### Pumps run too fast in Wokwi

Add `delay(50);` inside `loop()` in `PumpStation/src/main.cpp` to throttle the simulator. Remove the delay for real hardware.

### pH/EC readings are wrong

Re‑calibrate using two‑point calibration (see section above). Ensure the potentiometers in Wokwi are set correctly.

### Pumps don't start

- Check relay VCC and ESP pin connections.
- Verify MQTT topics match.
- Look at the pump station serial monitor – it prints the command it receives and any errors.
- Ensure the watchdog hasn't blocked the dose (check server logs for "Cooldown active" or "Daily limit exceeded").

### Network drop causes emergency stop (real hardware)

The grace period is 30 seconds (`WIFI_GRACE_PERIOD_MS`). Increase it if your WiFi is unstable. The pump station will save the pending dose in RTC memory and resume after reboot.

### Server shows `Schema Env Error` during tests

The global mock in `tests/setup.js` already mocks `fs.readFileSync`. Ensure you have run `npm run test` from the `dwc-server` directory.

### Dashboard doesn't show data

You need to serve your own frontend that connects to Socket.io on the same port (3000) and listens to `telemetry_update` and `network_update` events. The raw event payloads are documented in the server logs.

---

## License

MIT – free for personal and commercial use.  
**Author**: Kevin  
**Contributions**: welcome via pull requests.

---

## Future Improvements

- Add a proper frontend dashboard (React/Vue) that consumes the Socket.io events.
- Implement a PPFD sensor (I²C) for true light‑based EC boosting.
- Add support for multiple grow pots (valves C and D are already wired but not used in the engine).
- Store historical telemetry in a time‑series database (InfluxDB) for analytics.
- Add an API endpoint to manually trigger a dose or delivery.

---

_Happy growing!_ 🌱
