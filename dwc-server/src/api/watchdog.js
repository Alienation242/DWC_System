const express = require("express");
const router = express.Router();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Import the class so you can use its logic if needed in other routes
// Adjust the relative path if your folders are structured differently
const Watchdog = require("../services/watchdog");

// GET /api/watchdog/config
router.get("/config", async (req, res) => {
  try {
    const configs = await prisma.watchdogConfig.findMany();
    res.json(configs);
  } catch (error) {
    console.error("Error fetching watchdog configs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Example: Using the class inside a route
router.post("/check-dose", async (req, res) => {
  try {
    const { pumpName, ml, potId } = req.body;
    const isSafe = await Watchdog.isSafeToDose(pumpName, ml, potId);

    res.json({ safe: isSafe });
  } catch (error) {
    console.error("Error checking dose safety:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
