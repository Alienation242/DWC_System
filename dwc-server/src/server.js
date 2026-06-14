const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const path = require("path");
const fs = require("fs").promises;

const MqttService = require("./services/mqttService");
const RecipeEngine = require("./services/recipeEngine");

// API routes
const calibrationRoutes = require("./api/calibration");
const watchdogRoutes = require("./api/watchdog");
const nutrientRoutes = require("./api/nutrient");
const telemetryRoutes = require("./api/telemetry");
const systemFactory = require("./api/system");
const manualFactory = require("./api/manual");

const app = express();
const server = http.createServer(app);
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// ------------------------------------------------------------
// AUTO-SEED database with default state & watchdog configs
// ------------------------------------------------------------
async function autoSeed() {
  console.log("🔍 Checking database state...");
  let systemConfig = {
    watchdog: { defaultDailyLimitMl: {}, defaultCooldownSecs: 30 },
  };
  try {
    const configPath = path.join(process.cwd(), "config", "system.json");
    const raw = await fs.readFile(configPath, "utf8");
    systemConfig = JSON.parse(raw);
  } catch {
    console.warn(
      "⚠️ Could not load system.json, using default watchdog limits",
    );
  }

  // Ensure SystemState exists
  let state = await prisma.systemState.findUnique({ where: { id: 1 } });
  if (!state) {
    console.log("🌱 SystemState missing – creating default...");
    state = await prisma.systemState.create({
      data: {
        currentStrain: "auto_kush",
        currentProfilePath: "src/recipes/default.json",
        currentDay: 50,
        automationMode: "AUTOMATED",
        sysVol: 18.0,
      },
    });
  }

  // Seed watchdog configs for all pumps (only in production)
  if (process.env.NODE_ENV !== "test") {
    const requiredPumps = [
      { name: "pH_Down", limit: 20.0 },
      { name: "pH_Up", limit: 20.0 },
      { name: "Micro", limit: 250.0 },
      { name: "Bloom", limit: 250.0 },
      { name: "CalMag", limit: 250.0 },
      { name: "Gro", limit: 250.0 },
      { name: "Finisher", limit: 250.0 },
      { name: "Water", limit: 20000.0 },
    ];
    for (const pump of requiredPumps) {
      const exists = await prisma.watchdogConfig.findUnique({
        where: { pumpName: pump.name },
      });
      if (!exists) {
        console.log(`🛡️ Creating Watchdog Config for ${pump.name}...`);
        await prisma.watchdogConfig.create({
          data: {
            pumpName: pump.name,
            dailyLimitMl: pump.limit,
            cooldownSecs: systemConfig.watchdog.defaultCooldownSecs,
            enabled: true,
          },
        });
      }
    }
  }
  console.log("✅ Database ready.");
  return state;
}

// ------------------------------------------------------------
// WebSocket server (for real‑time telemetry)
// ------------------------------------------------------------
const io = new Server(server, { cors: { origin: "*" } });
io.on("connection", (socket) => {
  console.log(`💻 Dashboard Client Connected: ${socket.id}`);
  socket.on("disconnect", () =>
    console.log(`🛑 Client Disconnected: ${socket.id}`),
  );
});

// ------------------------------------------------------------
// MQTT & Recipe Engine
// ------------------------------------------------------------
const hardwareComms = new MqttService(io);
const engine = new RecipeEngine(hardwareComms);

// ------------------------------------------------------------
// Register API routes
// ------------------------------------------------------------
app.use("/api/calibration", calibrationRoutes);
app.use("/api/watchdog", watchdogRoutes);
app.use("/api/nutrient-config", nutrientRoutes);
app.use("/api/telemetry", telemetryRoutes);
app.use("/api/system", systemFactory(engine));
app.use("/api/manual", manualFactory(engine, hardwareComms));

// Health check
app.get("/api/status", (req, res) => {
  res.json({
    status: "Online",
    mode: "Headless DWC Server - Autonomous Loop Active",
    hardware: hardwareComms.deviceRegistry,
  });
});

// ------------------------------------------------------------
// Autonomous engine tick (every 5 minutes)
// ------------------------------------------------------------
let firstTelemetryReceived = false;
hardwareComms.on("telemetry", () => {
  if (!firstTelemetryReceived) {
    firstTelemetryReceived = true;
    console.log("📡 First telemetry – triggering initial engine tick.");
    engine.executeTick().catch(console.error);
  }
});

const TICK_INTERVAL_MS = 5 * 60 * 1000;
async function runEngineLoop() {
  await engine.executeTick();
  setTimeout(runEngineLoop, TICK_INTERVAL_MS);
}

// ------------------------------------------------------------
// Start server
// ------------------------------------------------------------
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  autoSeed()
    .then(async () => {
      // Clear any orphaned batch
      const incompleteBatch = await prisma.batchState.findFirst({
        where: { active: true },
      });
      if (incompleteBatch) {
        console.warn("⚠️ Found incomplete batch. Sending emergency stop.");
        hardwareComms.sendCommand("stop");
        await prisma.batchState.update({
          where: { id: incompleteBatch.id },
          data: { active: false },
        });
      }
      server.listen(PORT, () => {
        console.log(`\n🚀 Smart DWC Server running on port ${PORT}`);
        console.log(
          `⏱️  Engine tick interval: ${TICK_INTERVAL_MS / 1000 / 60} minutes`,
        );
        setTimeout(runEngineLoop, 5000);
      });
    })
    .catch((err) => {
      console.error("❌ Failed to seed database:", err);
      process.exit(1);
    });
}

if (process.env.NODE_ENV === "test") {
  module.exports = {
    app,
    _autoSeed: autoSeed,
    _runEngineLoop: runEngineLoop,
    _hardwareComms: hardwareComms,
    _engine: engine,
  };
} else {
  module.exports = app;
}
