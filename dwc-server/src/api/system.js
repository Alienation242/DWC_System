const express = require("express");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

module.exports = (engine) => {
  const router = express.Router();

  router.get("/state", async (req, res) => {
    const state = await prisma.systemState.findUnique({ where: { id: 1 } });
    res.json(state);
  });

  router.post("/advance-day", async (req, res) => {
    const state = await prisma.systemState.update({
      where: { id: 1 },
      data: { currentDay: { increment: 1 } },
    });
    res.json({ currentDay: state.currentDay });
  });

  router.post("/override", async (req, res) => {
    const { mode } = req.body;
    const state = await prisma.systemState.update({
      where: { id: 1 },
      data: { automationMode: mode },
    });
    res.json({ automationMode: state.automationMode });
  });

  router.get("/target", async (req, res) => {
    try {
      const systemState = await prisma.systemState.findFirst();
      if (!systemState)
        return res.status(404).json({ error: "No system state" });
      const { strainProfile } = await engine._loadTickConfigs(systemState);
      const dynamic = engine.getDynamicTarget(
        strainProfile,
        systemState.currentDay || 1,
        null,
      );
      res.json({ targetPPM: dynamic.targetPPM, phase: dynamic.phase });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
