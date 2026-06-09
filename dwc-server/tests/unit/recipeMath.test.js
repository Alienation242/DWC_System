const RecipeEngine = require("../../src/services/recipeEngine");

describe("RecipeEngine - Frontend Simulator Math Alignment", () => {
  let engine;

  beforeAll(() => {
    engine = new RecipeEngine(null);
  });

  // Target = 500, Deficit = 100, Stage = VEG, Day = 14, SysVol = 18L
  test("1. VEGETATIVE: 3-2-1 Ratio with exact Frontend PPM-to-mL scaling", () => {
    // Added '14' as the currentDay parameter
    const result = engine.calculateDeficit(500, 100, "VEGETATIVE", 14, 18.0);

    expect(result.cal).toBeCloseTo(1.44, 2);
    expect(result.gro).toBeCloseTo(9.2375 * (3 / 6), 2);
    expect(result.micro).toBeCloseTo(9.2375 * (2 / 6), 2);
    expect(result.bloom).toBeCloseTo(9.2375 * (1 / 6), 2);
    expect(result.fin).toBe(0);
  });

  test("2. INITIATION: 1-1-1 Ratio with increased 250 PPM CalMag cap", () => {
    const result = engine.calculateDeficit(700, 200, "INITIATION", 35, 10.0);
    expect(result.cal).toBeCloseTo(1.904, 2);
    expect(result.gro).toBeCloseTo(9.426 * (1 / 3), 2);
    expect(result.micro).toBeCloseTo(9.426 * (1 / 3), 2);
    expect(result.bloom).toBeCloseTo(9.426 * (1 / 3), 2);
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

  // ==========================================
  // THE NEW TEST: Seedling Phase Override
  // ==========================================
  test("6. SEEDLING (Day <= 7): 1-1-1 Ratio regardless of Vegetative stage", () => {
    // Target = 300, Deficit = 100, Stage = VEGETATIVE, Day = 5, SysVol = 10L
    // Cal Target = 150, Base Target = 150 (Ratio: 50% / 50%)
    // Deficit Base = 50 PPM -> in 10L = 500 / 136.4 = 3.665 mL
    const result = engine.calculateDeficit(300, 100, "VEGETATIVE", 5, 10.0);

    expect(result.cal).toBeCloseTo(1.333, 2);

    // Even though it is "VEGETATIVE", day 5 forces 1-1-1, NOT 3-2-1!
    expect(result.gro).toBeCloseTo(3.665 / 3, 2);
    expect(result.micro).toBeCloseTo(3.665 / 3, 2);
    expect(result.bloom).toBeCloseTo(3.665 / 3, 2);
    expect(result.fin).toBe(0);
  });
});
