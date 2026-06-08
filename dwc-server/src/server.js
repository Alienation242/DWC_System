const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const MqttService = require("./services/mqttService");
const RecipeEngine = require("./services/recipeEngine");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

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
// Wakes up every 5 minutes (300,000 ms) to evaluate the system
const TICK_INTERVAL_MS = 5 * 60 * 1000;

setInterval(async () => {
  await engine.executeTick();
}, TICK_INTERVAL_MS);

// Run an initial tick 5 seconds after boot so we don't have to wait 5 minutes to test it
setTimeout(() => {
  engine.executeTick();
}, 5000);

// Basic API Check
app.get("/api/status", (req, res) => {
  res.json({
    status: "Online",
    mode: "Headless DWC Server - Autonomous Loop Active",
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Smart DWC Server running on port ${PORT}`);
  console.log(
    `⏱️  Autonomous Engine Tick set to ${TICK_INTERVAL_MS / 1000 / 60} minutes.`,
  );
});
