const CalibrationService = require("../../../src/services/calibrationService");
const fs = require("fs").promises;

jest.mock("fs", () => ({
  promises: { readFile: jest.fn(), writeFile: jest.fn() },
}));

describe("CalibrationService", () => {
  const mockCal = {
    pH: { rawLow: 0, realLow: 1.0, rawHigh: 4095, realHigh: 12.0 },
    EC: { rawLow: 0, realLow: 0, rawHigh: 4095, realHigh: 8000 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress expected console.error from load() fallback
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  test("load returns defaults on missing file", async () => {
    fs.readFile.mockRejectedValue(new Error("ENOENT"));
    const cal = await CalibrationService.load();
    expect(cal.pH.rawLow).toBe(0);
    expect(cal.EC.realHigh).toBe(8000);
  });

  test("load parses existing file", async () => {
    fs.readFile.mockResolvedValue(JSON.stringify(mockCal));
    const cal = await CalibrationService.load();
    expect(cal.pH.realHigh).toBe(12.0);
  });

  test("save writes to file", async () => {
    await CalibrationService.save(mockCal);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("calibration.json"),
      JSON.stringify(mockCal, null, 2),
    );
  });

  test("convertPH linear mapping", async () => {
    fs.readFile.mockResolvedValue(JSON.stringify(mockCal));
    const ph = await CalibrationService.convertPH(2048);
    // 2048 * (12-1)/4095 + 1 = 2048*11/4095 + 1 ≈ 6.5
    expect(ph).toBeCloseTo(6.5, 1);
  });

  test("convertEC linear mapping", async () => {
    fs.readFile.mockResolvedValue(JSON.stringify(mockCal));
    const ec = await CalibrationService.convertEC(2048);
    // 2048 * 8000 / 4095 ≈ 4000.9768 → rounds to 4001
    expect(ec).toBeCloseTo(4001, 0);
  });
});
