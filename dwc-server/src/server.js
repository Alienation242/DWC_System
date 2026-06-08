const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const MqttService = require("./services/mqttService");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(server, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  console.log(`Dashboard Client Connected: ${socket.id}`);
  socket.on("disconnect", () => {
    console.log(`Client Disconnected: ${socket.id}`);
  });
});

const hardwareComms = new MqttService(io);

app.get("/api/status", (req, res) => {
  res.json({ status: "Online", mode: "Headless DWC Server" });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\nSmart DWC Server running on port ${PORT}`);
});
