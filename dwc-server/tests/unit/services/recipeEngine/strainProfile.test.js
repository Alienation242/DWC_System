const RecipeEngine = require("../../../../src/services/recipeEngine");

describe("Strain profile handling", () => {
  let engine;
  const autoKush = {
    flipWeek: 5,
    stretchWks: 2,
    bulkWks: 4,
    ripenWks: 3,
    phases: {
      veg: {
        basePpm: { start: 50, end: 500, curve: 1.5 },
        ppfd: { start: 250, end: 550, curve: 1.0 },
        lightMult: { start: 0.5, end: 0.5, curve: 1.0 },
      },
      initiation: {
        basePpm: { start: 500, end: 750, curve: 1.0 },
        ppfd: { start: 650, end: 950, curve: 1.0 },
        lightMult: { start: 0.5, end: 0.5, curve: 1.0 },
      },
      bulking: {
        basePpm: { start: 350, end: 350, curve: 1.0 },
        ppfd: { start: 950, end: 1050, curve: 1.0 },
        lightMult: { start: 0.5, end: 0.5, curve: 1.0 },
      },
      ripening: {
        basePpm: { start: 650, end: 650, curve: 1.0 },
        ppfd: { start: 1050, end: 800, curve: 1.5 },
        lightMult: { start: 0.5, end: 0.5, curve: 1.0 },
      },
    },
  };

  beforeAll(() => {
    engine = new RecipeEngine(null);
  });

  test("veg day 1 target PPM is start value", () => {
    const target = engine.getTargetsForDay(autoKush, 1);
    expect(target.targetPPM).toBeCloseTo(50, 1);
  });

  test("veg day 28 target PPM is interpolated", () => {
    const target = engine.getTargetsForDay(autoKush, 28);
    // flipDay = (5-1)*7 = 28, so day 28 is last veg day, progress = 1 → end = 500
    expect(target.targetPPM).toBeCloseTo(500, 1);
  });

  test("initiation day 1 is start = 500", () => {
    const target = engine.getTargetsForDay(autoKush, 29);
    expect(target.targetPPM).toBe(500);
  });

  test("dynamic target with light boost", () => {
    // veg day 14, target PPFD ~ 250+ (14/28)*300 = 400, live 600 → excess 200, boost 100 → floor maybe ~200
    const floor = engine.getTargetsForDay(autoKush, 14).targetPPM;
    const boosted = engine.getDynamicTarget(autoKush, 14, 600);
    expect(boosted.targetPPM).toBeGreaterThan(floor);
  });
});
