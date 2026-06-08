const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const MqttService = require("./services/mqttService");
const RecipeEngine = require("./services/recipeEngine");

const app = express();
const server = http.createServer(app);
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

async function autoSeed() {
  console.log("🔍 Checking database state...");

  // 1. SystemState (id = 1)
  let state = await prisma.systemState.findUnique({ where: { id: 1 } });
  if (!state) {
    console.log("🌱 SystemState missing – creating default...");
    state = await prisma.systemState.create({
      data: {
        currentStrain: "auto_kush",
        currentProfilePath: "./recipes/default.json",
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
  ];
  for (const pump of requiredPumps) {
    const existing = await prisma.watchdogConfig.findUnique({
      where: { pumpName: pump },
    });
    if (!existing) {
      console.log(`🌱 Creating WatchdogConfig for ${pump}...`);
      await prisma.watchdogConfig.create({
        data: {
          pumpName: pump,
          dailyLimitMl: 15.0,
          cooldownSecs: 30,
          enabled: true,
        },
      });
    }
  }

  console.log("✅ Database ready.");
  return state;
}

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

// 1. Initialize WebSockets for the future Dashboard
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  console.log(`💻 Dashboard Client Connected: ${socket.id}`);
  socket.on("disconnect", () =>
    console.log(`🛑 Client Disconnected: ${socket.id}`),
  );
});

// 2. Boot the Hardware Communication Layer
const hardwareComms = new MqttService(io);

// 3. Boot the Autonomous Brain
const engine = new RecipeEngine(hardwareComms);

// --- THE CRON LOOP ---
const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

setInterval(async () => {
  await engine.executeTick();
}, TICK_INTERVAL_MS);

// Basic API Check
app.get("/api/status", (req, res) => {
  res.json({
    status: "Online",
    mode: "Headless DWC Server - Autonomous Loop Active",
  });
});

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
