const express = require("express");
const fs = require("fs").promises;
const path = require("path");

const router = express.Router();
const NUTRIENT_PROFILE_PATH = path.join(
  process.cwd(),
  "config",
  "nutrient_profile.json",
);

router.get("/", async (req, res) => {
  try {
    const data = await fs.readFile(NUTRIENT_PROFILE_PATH, "utf8");
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: "Failed to load nutrient profile." });
  }
});

router.post("/", async (req, res) => {
  try {
    const newConfig = req.body;
    await fs.writeFile(
      NUTRIENT_PROFILE_PATH,
      JSON.stringify(newConfig, null, 2),
    );
    res.json({ success: true, config: newConfig });
  } catch (err) {
    res.status(500).json({ error: "Failed to save nutrient profile." });
  }
});

module.exports = router;
