module.exports = (engine, hardwareComms) => {
  const express = require("express");
  const router = express.Router();

  // Emergency stop
  router.post("/stop", async (req, res) => {
    try {
      const seq = hardwareComms.nextSeq();
      hardwareComms.sendCommand("stop", 0, "None", seq);
      res.json({ success: true, message: "Emergency stop sent" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dose (water, pH up/down, nutrients)
  router.post("/dose", async (req, res) => {
    const { pumpName, actionStr, ml, potId = "A" } = req.body;
    if (!pumpName || !actionStr || !ml) {
      return res
        .status(400)
        .json({ error: "Missing pumpName, actionStr or ml" });
    }
    try {
      const isPhDose = pumpName === "pH_Down" || pumpName === "pH_Up";
      if (isPhDose) {
        const waterDosed = await engine.executePumpAndWait(
          "Water",
          "dose_water",
          250,
          { potId },
        );
        const phDosed = await engine.executePumpAndWait(
          pumpName,
          actionStr,
          ml,
          { potId },
        );
        res.json({
          success: true,
          dosedMl: waterDosed + phDosed,
          details: { water: waterDosed, ph: phDosed, potId },
        });
      } else {
        const dosed = await engine.executePumpAndWait(pumpName, actionStr, ml, {
          potId,
        });
        res.json({ success: true, dosedMl: dosed, potId });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Deliver mixed solution to a specific pot
  router.post("/deliver", async (req, res) => {
    const { target, volumeMl } = req.body;
    if (!target || !volumeMl) {
      return res.status(400).json({ error: "Missing target or volumeMl" });
    }
    try {
      await engine._deliverToPot(volumeMl, target);
      res.json({
        success: true,
        message: `Delivered ${volumeMl}ml to pot ${target}`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
