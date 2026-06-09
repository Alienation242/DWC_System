const RecipeEngine = require("../../src/services/recipeEngine");

describe("RecipeEngine Math", () => {
  let engine;

  beforeAll(() => {
    // We pass 'null' for the MQTT service because we don't need it for pure math!
    engine = new RecipeEngine(null);
  });

  test("calculates correct vegetative nutrient ratios (3-2-1)", () => {
    // targetPPM = 500, deficit = 100, stage = VEGETATIVE, exactDays = 14, sysVol = 18L
    const result = engine.calculateDeficitMath(
      500,
      100,
      "VEGETATIVE",
      14,
      18.0,
    );

    // Veg target cal is 150. Total is 500. Base is 350.
    // Ensure CalMag is calculated correctly
    expect(result.cal).toBeGreaterThan(0);

    // Ensure 3-2-1 ratio for Gro-Micro-Bloom
    expect(result.gro).toBeCloseTo(result.bloom * 3, 1);
    expect(result.micro).toBeCloseTo(result.bloom * 2, 1);

    // Ensure finisher is 0 during veg
    expect(result.fin).toBe(0);
  });

  test("calculates correct ripening ratios (finisher only)", () => {
    const result = engine.calculateDeficitMath(800, 200, "RIPENING", 50, 18.0);

    expect(result.gro).toBe(0);
    expect(result.micro).toBe(0);
    expect(result.bloom).toBe(0);
    expect(result.fin).toBeGreaterThan(0);
  });
});
