module.exports = (engine, hardwareComms) => {
  const express = require("express");
  const router = express.Router();

  router.post("/stop", async (req, res) => {
    try {
      const seq = hardwareComms.nextSeq();
      hardwareComms.sendCommand("stop", 0, "None", seq);
      res.json({ success: true, message: "Emergency stop sent" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/dose", async (req, res) => {
    const { pumpName, actionStr, ml } = req.body;
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
        );
        const phDosed = await engine.executePumpAndWait(
          pumpName,
          actionStr,
          ml,
        );
        res.json({
          success: true,
          dosedMl: waterDosed + phDosed,
          details: { water: waterDosed, ph: phDosed },
        });
      } else {
        const dosed = await engine.executePumpAndWait(pumpName, actionStr, ml);
        res.json({ success: true, dosedMl: dosed });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/deliver", async (req, res) => {
    const { target, volumeMl } = req.body;
    if (!target || !volumeMl) {
      return res.status(400).json({ error: "Missing target or volumeMl" });
    }
    try {
      await engine._deliverToPot(volumeMl, target);
      res.json({ success: true, message: "Delivery completed" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
