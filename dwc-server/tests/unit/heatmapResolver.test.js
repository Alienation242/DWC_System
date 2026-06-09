const RecipeEngine = require("../../src/services/recipeEngine");

describe("RecipeEngine - PPFD to PPM Heatmap State Machine", () => {
  let engine;

  // The EXACT data from candy_games.json
  const candyGamesMock = {
    name: "Candy Games #36",
    flipWeek: 9, // Veg = 56 days
    stretchWks: 2, // Init = 14 days
    bulkWks: 4, // Bulk = 28 days
    ripenWks: 3, // Ripen = 21 days
    phases: {
      veg: {
        ppfd: { start: 250, end: 500, curve: 1.0 },
        basePpm: { start: 35, end: 750, curve: 1.5 },
        lightMult: { start: 0.5, end: 0.5, curve: 1.0 },
      },
      initiation: {
        ppfd: { start: 675, end: 1000, curve: 1.0 },
        basePpm: { start: 662.5, end: 800, curve: 1.0 },
        lightMult: { start: 0.5, end: 0.5, curve: 1.0 },
      },
      ripening: {
        ppfd: { start: 1000, end: 800, curve: 1.0 },
        basePpm: { start: 800, end: 0, curve: 1.0 },
        lightMult: { start: 0.5, end: 0.5, curve: 1.0 },
      },
    },
  };

  beforeAll(() => {
    engine = new RecipeEngine(null);
  });

  test("1. DEFENDS THE FLOOR: Returns base PPM if live light is at or below target PPFD", () => {
    // Veg Day 29 out of 56. Progress = (29 - 1) / (56 - 1) = 28 / 55 = 0.50909
    // PPFD Target = 250 + 250 * 0.50909 = 377.27
    // Base PPM Target = 35 + 715 * (0.50909^1.5) = 294.716
    const resultAtTarget = engine.getDynamicTarget(candyGamesMock, 29, 377.27);
    const resultBelowTarget = engine.getDynamicTarget(candyGamesMock, 29, 200);

    expect(resultAtTarget.targetPPM).toBeCloseTo(294.7, 1);
    expect(resultBelowTarget.targetPPM).toBeCloseTo(294.7, 1);
  });

  test("2. THE HEATMAP MULTIPLIER: Scales PPM threshold upward based on excess PPFD", () => {
    // Target PPFD = 377.27. Base PPM = 294.71. lightMult = 0.5.
    // We blast it with 575 PPFD (+197.73 excess).
    // +197.73 * 0.5 = +98.86 PPM boost.
    // Expected Dynamic Target = 294.71 + 98.86 = 393.57 PPM.
    const result = engine.getDynamicTarget(candyGamesMock, 29, 575);

    expect(result.targetPPM).toBeCloseTo(393.6, 1);
  });

  test("3. INITIATION HARD CUT + HEATMAP: Scales correctly on hard phase transitions", () => {
    // Day 57 (Day 1 of Initiation).
    // Target PPFD = 675. Base PPM = 662.5. Mult = 0.5.
    // We blast it with 1075 PPFD (+400 excess).
    // +400 * 0.5 = +200 PPM.
    // Expected Dynamic Target = 862.5 PPM.
    const result = engine.getDynamicTarget(candyGamesMock, 57, 1075);

    expect(result.targetPPM).toBeCloseTo(862.5, 1);
  });

  test("4. OVERRIDE: Ripening flush completely ignores light multipliers", () => {
    // Day 119 (Last day of Ripening flush).
    // Base PPM must be 0, regardless of how much light is hitting the plant.
    const result = engine.getDynamicTarget(candyGamesMock, 119, 1500); // Blasting 1500 PPFD

    expect(result.targetPPM).toBe(0);
  });

  test("5. SENSORLESS DEFAULT: If no PPFD sensor is provided, defaults to optimal target", () => {
    // Veg Day 29. Target PPFD = 377.27.
    // If we pass null (no sensor), it should use 377.27 as the reference.
    // Excess = 377.27 - 377.27 = 0.
    // Expected Dynamic Target = Floor PPM (294.7).
    const result = engine.getDynamicTarget(candyGamesMock, 29, null);

    expect(result.targetPPM).toBeCloseTo(294.7, 1);
  });
});
