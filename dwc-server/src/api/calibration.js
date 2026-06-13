const express = require("express");
const router = express.Router();
const CalibrationService = require("../services/calibrationService");

router.get("/", async (req, res) => {
  try {
    const cal = await CalibrationService.load();
    res.json(cal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { pH, EC } = req.body;
    const current = await CalibrationService.load();
    if (pH) {
      current.pH = {
        ...current.pH,
        ...pH,
        lastCalibration: new Date().toISOString(),
      };
    }
    if (EC) {
      current.EC = {
        ...current.EC,
        ...EC,
        lastCalibration: new Date().toISOString(),
      };
    }
    await CalibrationService.save(current);
    res.json(current);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
