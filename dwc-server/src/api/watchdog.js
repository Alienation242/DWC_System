const express = require("express");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const router = express.Router();

router.get("/config", async (req, res) => {
  try {
    const configs = await prisma.watchdogConfig.findMany();
    res.json(configs);
  } catch (err) {
    console.error("Error fetching watchdog configs:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/config", async (req, res) => {
  try {
    const { pumpName, dailyLimitMl, cooldownSecs, enabled } = req.body;
    const updated = await prisma.watchdogConfig.upsert({
      where: { pumpName },
      update: { dailyLimitMl, cooldownSecs, enabled },
      create: { pumpName, dailyLimitMl, cooldownSecs, enabled },
    });
    res.json(updated);
  } catch (err) {
    console.error("Error upserting watchdog config:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
