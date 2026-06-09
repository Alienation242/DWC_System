const RecipeEngine = require("../../src/services/recipeEngine");

describe("RecipeEngine - Strain Profile Target Generator", () => {
  let engine;

  // The EXACT data from candy_games.json
  const candyGamesMock = {
    name: "Candy Games #36",
    flipWeek: 9, // Veg = 56 days (8 weeks)
    stretchWks: 2, // Init = 14 days
    bulkWks: 4, // Bulk = 28 days
    ripenWks: 3, // Ripen = 21 days
    phases: {
      veg: { basePpm: { start: 35, end: 750, curve: 1.5 } },
      initiation: { basePpm: { start: 662.5, end: 800, curve: 1.0 } },
      bulking: { basePpm: { start: 800, end: 800, curve: 1.0 } },
      ripening: { basePpm: { start: 800, end: 0, curve: 1.0 } },
    },
  };

  beforeAll(() => {
    engine = new RecipeEngine(null);
  });

  test("1. Parses Stage Mapping correctly based on real weeks", () => {
    // Day 56 is the exact last day of Veg (flipWeek 9 = 8 full weeks)
    expect(engine.getTargetsForDay(candyGamesMock, 56).phase).toBe(
      "VEGETATIVE",
    );

    // Day 57 is day 1 of Initiation
    expect(engine.getTargetsForDay(candyGamesMock, 57).phase).toBe(
      "INITIATION",
    );

    // Day 71 is day 1 of Bulking (56 + 14 = 70. 71 is Bulk Day 1)
    expect(engine.getTargetsForDay(candyGamesMock, 71).phase).toBe("BULKING");

    // Day 99 is day 1 of Ripening (56 + 14 + 28 = 98. 99 is Ripen Day 1)
    expect(engine.getTargetsForDay(candyGamesMock, 99).phase).toBe("RIPENING");
  });

  test("2. Interpolates curve with precise Hard Cut Math", () => {
    // Initiation is Day 57 to 70 (14 days). Start 662.5, End 800.
    // Day 63 is the 7th day of 14.
    // Progress = (7 - 1) / (14 - 1) = 6 / 13 = 0.461538...
    // Target = 662.5 + (137.5 * 0.461538) = 725.96...
    const result = engine.getTargetsForDay(candyGamesMock, 63);

    expect(result.targetPPM).toBeCloseTo(725.96, 1);
  });

  test("3. THE RIPENING FLUSH: Sustains heavy feeding, then instantly flushes", () => {
    // Ripening is Day 99 to 119 (21 days). Start 800.

    // Day 117 (Day 19 of 21) -> 2 days remaining. Should NOT drop yet.
    expect(engine.getTargetsForDay(candyGamesMock, 117).targetPPM).toBe(800);

    // Day 118 (Day 20 of 21) -> 1 day remaining. INSTANT FLUSH TO 0.
    expect(engine.getTargetsForDay(candyGamesMock, 118).targetPPM).toBe(0);

    // Day 119 (Day 21 of 21) -> 0 days remaining. FLUSH TO 0.
    expect(engine.getTargetsForDay(candyGamesMock, 119).targetPPM).toBe(0);
  });
});
