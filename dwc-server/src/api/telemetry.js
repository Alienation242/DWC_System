const express = require("express");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const router = express.Router();

router.get("/latest/:potId", async (req, res) => {
  const potId = req.params.potId;
  try {
    const latest = await prisma.telemetryLog.findFirst({
      where: { potId },
      orderBy: { timestamp: "desc" },
    });
    res.json(latest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/history/:potId", async (req, res) => {
  const potId = req.params.potId;
  const limit = parseInt(req.query.limit) || 100;
  try {
    const history = await prisma.telemetryLog.findMany({
      where: { potId },
      orderBy: { timestamp: "asc" },
      take: limit,
    });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/doses/:potId", async (req, res) => {
  const potId = req.params.potId;
  const limit = parseInt(req.query.limit) || 20;
  try {
    const doses = await prisma.doseLog.findMany({
      where: { potId },
      orderBy: { timestamp: "desc" },
      take: limit,
    });
    res.json(doses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
