const RecipeEngine = require("../../src/services/recipeEngine");

describe("RecipeEngine - PPFD to PPM Heatmap State Machine", () => {
  let engine;

  const candyGamesMock = {
    name: "Candy Games #36",
    flipWeek: 9,
    stretchWks: 2,
    bulkWks: 4,
    ripenWks: 3,
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
    const resultAtTarget = engine.getDynamicTarget(candyGamesMock, 29, 377.27);
    const resultBelowTarget = engine.getDynamicTarget(candyGamesMock, 29, 200);
    expect(resultAtTarget.targetPPM).toBeCloseTo(294.7, 1);
    expect(resultBelowTarget.targetPPM).toBeCloseTo(294.7, 1);
  });

  test("2. THE HEATMAP MULTIPLIER: Scales PPM threshold upward based on excess PPFD", () => {
    const result = engine.getDynamicTarget(candyGamesMock, 29, 575);
    // Excess = 575 - 377.27 = 197.73, boost = min(150, 197.73*0.5) = min(150,98.86) = 98.86
    // Expected = 294.71 + 98.86 = 393.57
    expect(result.targetPPM).toBeCloseTo(393.6, 1);
  });

  test("3. INITIATION HARD CUT + HEATMAP: Scales correctly with cap", () => {
    // Day 57 (first day of initiation)
    // Target PPFD = 675, Base PPM = 662.5, lightMult = 0.5
    // livePPFD = 1075 → excess = 400, boost = min(150, 400*0.5) = min(150,200) = 150
    // Expected = 662.5 + 150 = 812.5
    const result = engine.getDynamicTarget(candyGamesMock, 57, 1075);
    expect(result.targetPPM).toBeCloseTo(812.5, 1);
  });

  test("4. OVERRIDE: Ripening flush completely ignores light multipliers", () => {
    const result = engine.getDynamicTarget(candyGamesMock, 119, 1500);
    expect(result.targetPPM).toBe(0);
  });

  test("5. SENSORLESS DEFAULT: If no PPFD sensor is provided, defaults to optimal target", () => {
    const result = engine.getDynamicTarget(candyGamesMock, 29, null);
    expect(result.targetPPM).toBeCloseTo(294.7, 1);
  });

  test("ripening flush with floorPpm === 0 returns target 0 immediately", () => {
    const result = engine.getDynamicTarget(candyGamesMock, 118, 1500);
    expect(result.targetPPM).toBe(0);
  });
});
