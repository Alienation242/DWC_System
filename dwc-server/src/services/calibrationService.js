const fs = require("fs").promises;
const path = require("path");

const CALIBRATION_PATH = path.join(process.cwd(), "config", "calibration.json");

class CalibrationService {
  static async load() {
    try {
      const data = await fs.readFile(CALIBRATION_PATH, "utf8");
      return JSON.parse(data);
    } catch (err) {
      console.error(
        "⚠️ Failed to load calibration file, using defaults:",
        err.message,
      );
      return {
        /* defaults */
      };
    }
  }

  static async save(calibration) {
    await fs.writeFile(CALIBRATION_PATH, JSON.stringify(calibration, null, 2));
  }

  static mapValue(x, in_min, in_max, out_min, out_max) {
    return ((x - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;
  }

  static async convertPH(raw) {
    const cal = await this.load();
    return this.mapValue(
      raw,
      cal.pH.rawLow,
      cal.pH.rawHigh,
      cal.pH.realLow,
      cal.pH.realHigh,
    );
  }

  static async convertEC(raw) {
    const cal = await this.load();
    return this.mapValue(
      raw,
      cal.EC.rawLow,
      cal.EC.rawHigh,
      cal.EC.realLow,
      cal.EC.realHigh,
    );
  }
}

module.exports = CalibrationService;
