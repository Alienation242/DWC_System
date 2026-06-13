const express = require("express");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const router = express.Router();

router.get("/config", async (req, res) => {
  const configs = await prisma.watchdogConfig.findMany();
  res.json(configs);
});

router.post("/config", async (req, res) => {
  const { pumpName, dailyLimitMl, cooldownSecs, enabled } = req.body;
  const updated = await prisma.watchdogConfig.upsert({
    where: { pumpName },
    update: { dailyLimitMl, cooldownSecs, enabled },
    create: { pumpName, dailyLimitMl, cooldownSecs, enabled },
  });
  res.json(updated);
});

module.exports = router;
