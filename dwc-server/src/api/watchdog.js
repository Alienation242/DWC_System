const express = require("express");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const router = express.Router();

// GET all watchdog configs (called by frontend at /api/watchdog/config)
router.get("/config", async (req, res) => {
  try {
    const configs = await prisma.watchdogConfig.findMany();
    res.json(configs);
  } catch (err) {
    console.error("GET /api/watchdog/config error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST upsert a single watchdog config
router.post("/config", async (req, res) => {
  try {
    const { pumpName, dailyLimitMl, cooldownSecs, enabled } = req.body;
    const config = await prisma.watchdogConfig.upsert({
      where: { pumpName },
      update: { dailyLimitMl, cooldownSecs, enabled },
      create: { pumpName, dailyLimitMl, cooldownSecs, enabled },
    });
    res.json(config);
  } catch (err) {
    console.error("POST /api/watchdog/config error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
