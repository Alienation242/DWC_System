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
      // Return sensible defaults for 0-4095 ADC range
      return {
        pH: {
          rawLow: 0,
          realLow: 1.0,
          rawHigh: 4095,
          realHigh: 12.0,
          lastCalibration: new Date().toISOString(),
        },
        EC: {
          rawLow: 0,
          realLow: 0.0,
          rawHigh: 4095,
          realHigh: 8000.0,
          lastCalibration: new Date().toISOString(),
        },
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
