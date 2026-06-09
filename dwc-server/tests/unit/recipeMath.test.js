const RecipeEngine = require("../../src/services/recipeEngine");

describe("RecipeEngine - Frontend Simulator Math Alignment", () => {
  let engine;

  beforeAll(() => {
    engine = new RecipeEngine(null);
  });

  test("1. VEGETATIVE: 3-2-1 Ratio with exact Frontend PPM-to-mL scaling", () => {
    const result = engine.calculateDeficit(500, 100, "VEGETATIVE", 14, 18.0);
    expect(result.cal).toBeCloseTo(1.44, 2);
    expect(result.gro).toBeCloseTo(9.2375 * (3 / 6), 2);
    expect(result.micro).toBeCloseTo(9.2375 * (2 / 6), 2);
    expect(result.bloom).toBeCloseTo(9.2375 * (1 / 6), 2);
    expect(result.fin).toBe(0);
  });

  test("2. INITIATION: 1-2-2 Ratio with increased 250 PPM CalMag cap", () => {
    const result = engine.calculateDeficit(700, 200, "INITIATION", 35, 10.0);
    // Expected values calculated from formula
    const targetPPM = 700;
    const deficitPPM = 200;
    const sysVol = 10;
    const targetCalCap = 250;
    const targetCalPpm = Math.min(targetPPM, targetCalCap); // 250
    const targetBasePpm = targetPPM - targetCalPpm; // 450
    const ratioCal = targetCalPpm / targetPPM; // 250/700 ≈ 0.35714
    const ratioBase = targetBasePpm / targetPPM; // 450/700 ≈ 0.64286
    const deficitCalPpm = deficitPPM * ratioCal; // 200 * 0.35714 ≈ 71.428
    const deficitBasePpm = deficitPPM * ratioBase; // 200 * 0.64286 ≈ 128.572
    const calMl = (deficitCalPpm * sysVol) / 375; // (71.428*10)/375 ≈ 1.9048
    const totalBaseMl = (deficitBasePpm * sysVol) / 136.4; // (128.572*10)/136.4 ≈ 9.426
    const partsG = 1,
      partsM = 2,
      partsB = 2;
    const totalParts = 5;
    const mlPerPart = totalBaseMl / totalParts; // 9.426/5 = 1.8852
    const gro = partsG * mlPerPart; // 1.8852
    const micro = partsM * mlPerPart; // 3.7704
    const bloom = partsB * mlPerPart; // 3.7704

    expect(result.cal).toBeCloseTo(calMl, 2);
    expect(result.gro).toBeCloseTo(gro, 2);
    expect(result.micro).toBeCloseTo(micro, 2);
    expect(result.bloom).toBeCloseTo(bloom, 2);
    expect(result.fin).toBe(0);
  });

  test("3. BULKING: 1-2-3 Ratio focusing heavily on Bloom", () => {
    const result = engine.calculateDeficit(1000, 50, "BULKING", 50, 20.0);
    expect(result.cal).toBeCloseTo(0.666, 2);
    expect(result.gro).toBeCloseTo(5.498 * (1 / 6), 2);
    expect(result.micro).toBeCloseTo(5.498 * (2 / 6), 2);
    expect(result.bloom).toBeCloseTo(5.498 * (3 / 6), 2);
  });

  test("4. RIPENING: 100% Finisher transition", () => {
    const result = engine.calculateDeficit(400, 100, "RIPENING", 70, 10.0);
    expect(result.cal).toBeCloseTo(1.666, 2);
    expect(result.gro).toBe(0);
    expect(result.fin).toBeCloseTo(2.749, 2);
  });

  test("5. LOW TARGET: CalMag dominates early growth", () => {
    const result = engine.calculateDeficit(100, 20, "VEGETATIVE", 14, 10.0);
    expect(result.cal).toBeCloseTo(0.533, 2);
    expect(result.gro).toBe(0);
  });

  test("6. SEEDLING (Day <= 7): 1-1-1 Ratio regardless of Vegetative stage", () => {
    const result = engine.calculateDeficit(300, 100, "VEGETATIVE", 5, 10.0);
    expect(result.cal).toBeCloseTo(1.333, 2);
    expect(result.gro).toBeCloseTo(3.665 / 3, 2);
    expect(result.micro).toBeCloseTo(3.665 / 3, 2);
    expect(result.bloom).toBeCloseTo(3.665 / 3, 2);
    expect(result.fin).toBe(0);
  });
});
