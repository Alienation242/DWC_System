const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const MqttService = require("./services/mqttService");
const CalibrationService = require("./services/calibrationService");
const RecipeEngine = require("./services/recipeEngine");

const fs = require("fs").promises;
const app = express();
const server = http.createServer(app);
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// ==========================================
// AUTO-SEED: creates SystemState & WatchdogConfigs if missing
// ==========================================
async function autoSeed() {
  console.log("🔍 Checking database state...");

  // Load system config for watchdog defaults
  let systemConfig = {
    watchdog: { defaultDailyLimitMl: {}, defaultCooldownSecs: 30 },
  };
  try {
    const configPath = path.join(process.cwd(), "config", "system.json");
    const raw = await fs.readFile(configPath, "utf8");
    systemConfig = JSON.parse(raw);
  } catch (err) {
    console.warn(
      "⚠️ Could not load system.json, using default watchdog limits",
    );
  }

  // 1. SystemState
  let state = await prisma.systemState.findUnique({ where: { id: 1 } });
  if (!state) {
    console.log("🌱 SystemState missing – creating default...");
    state = await prisma.systemState.create({
      data: {
        currentStrain: "auto_kush",
        currentProfilePath: "src/recipes/default.json",
        currentDay: 1,
        automationMode: "AUTOMATED",
        sysVol: 18.0,
      },
    });
  }

  // 2. WatchdogConfigs for all known pumps
  const requiredPumps = [
    "pH_Down",
    "pH_Up",
    "Micro",
    "Bloom",
    "CalMag",
    "Gro",
    "Finisher",
    "Water",
  ];
  for (const pump of requiredPumps) {
    const existing = await prisma.watchdogConfig.findUnique({
      where: { pumpName: pump },
    });
    if (!existing) {
      const dailyLimit =
        systemConfig.watchdog.defaultDailyLimitMl[pump] || 15.0;
      console.log(
        `🌱 Creating WatchdogConfig for ${pump} (limit ${dailyLimit}ml/day)...`,
      );
      await prisma.watchdogConfig.create({
        data: {
          pumpName: pump,
          dailyLimitMl: dailyLimit,
          cooldownSecs: systemConfig.watchdog.defaultCooldownSecs || 30,
          enabled: true,
        },
      });
    }
  }

  console.log("✅ Database ready.");
  return state;
}

// ==========================================
// CALIBRATION API
// ==========================================
app.get("/api/calibration", async (req, res) => {
  try {
    const cal = await CalibrationService.load();
    res.json(cal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/calibration", async (req, res) => {
  try {
    const { pH, EC } = req.body;
    const current = await CalibrationService.load();
    if (pH) {
      current.pH = {
        ...current.pH,
        ...pH,
        lastCalibration: new Date().toISOString(),
      };
    }
    if (EC) {
      current.EC = {
        ...current.EC,
        ...EC,
        lastCalibration: new Date().toISOString(),
      };
    }
    await CalibrationService.save(current);
    res.json(current);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// NUTRIENT BRAND CONFIGURATION API
// ==========================================
const NUTRIENT_PROFILE_PATH = path.join(
  process.cwd(),
  "config",
  "nutrient_profile.json",
);

app.get("/api/nutrient-config", async (req, res) => {
  try {
    const data = await fs.readFile(NUTRIENT_PROFILE_PATH, "utf8");
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: "Failed to load nutrient profile." });
  }
});

app.post("/api/nutrient-config", async (req, res) => {
  try {
    const newConfig = req.body;
    await fs.writeFile(
      NUTRIENT_PROFILE_PATH,
      JSON.stringify(newConfig, null, 2),
    );
    res.json({ success: true, config: newConfig });
  } catch (err) {
    res.status(500).json({ error: "Failed to save nutrient profile." });
  }
});

// ------------------ Watchdog API ------------------
app.get("/api/watchdog/config", async (req, res) => {
  const configs = await prisma.watchdogConfig.findMany();
  res.json(configs);
});

app.post("/api/watchdog/config", async (req, res) => {
  const { pumpName, dailyLimitMl, cooldownSecs, enabled } = req.body;
  const updated = await prisma.watchdogConfig.upsert({
    where: { pumpName },
    update: { dailyLimitMl, cooldownSecs, enabled },
    create: { pumpName, dailyLimitMl, cooldownSecs, enabled },
  });
  res.json(updated);
});

// ------------------ System control ------------------
app.get("/api/system/state", async (req, res) => {
  const state = await prisma.systemState.findUnique({ where: { id: 1 } });
  res.json(state);
});

app.post("/api/system/advance-day", async (req, res) => {
  const state = await prisma.systemState.update({
    where: { id: 1 },
    data: { currentDay: { increment: 1 } },
  });
  res.json({ currentDay: state.currentDay });
});

app.post("/api/system/override", async (req, res) => {
  const { mode } = req.body; // "AUTOMATED" or "MANUAL_OVERRIDE"
  const state = await prisma.systemState.update({
    where: { id: 1 },
    data: { automationMode: mode },
  });
  res.json({ automationMode: state.automationMode });
});

// ------------------ WebSockets ------------------
const io = new Server(server, { cors: { origin: "*" } });
io.on("connection", (socket) => {
  console.log(`💻 Dashboard Client Connected: ${socket.id}`);
  socket.on("disconnect", () =>
    console.log(`🛑 Client Disconnected: ${socket.id}`),
  );
});

// ------------------ MQTT & Engine ------------------
const hardwareComms = new MqttService(io);
const engine = new RecipeEngine(hardwareComms);

// ------------------ Cron Loop ------------------
const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
setInterval(async () => {
  await engine.executeTick();
}, TICK_INTERVAL_MS);

// ------------------ Health Check ------------------
app.get("/api/status", (req, res) => {
  res.json({
    status: "Online",
    mode: "Headless DWC Server - Autonomous Loop Active",
  });
});

// ------------------ Start Server ------------------
const PORT = process.env.PORT || 3000;

autoSeed()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`\n🚀 Smart DWC Server running on port ${PORT}`);
      console.log(
        `⏱️  Autonomous Engine Tick set to ${TICK_INTERVAL_MS / 1000 / 60} minutes.`,
      );
      // Run first tick after 5 seconds
      setTimeout(() => engine.executeTick(), 5000);
    });
  })
  .catch((err) => {
    console.error("❌ Failed to seed database on startup:", err);
    process.exit(1);
  });
