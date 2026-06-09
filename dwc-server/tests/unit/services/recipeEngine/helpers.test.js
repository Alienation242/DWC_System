const RecipeEngine = require("../../../../src/services/recipeEngine");

let engine;
beforeAll(() => {
  engine = new RecipeEngine(null);
});

describe("resolveCurve", () => {
  test("linear", () => {
    const param = { start: 100, end: 200, curve: 1.0 };
    expect(engine.resolveCurve(param, 0.5)).toBe(150);
    expect(engine.resolveCurve(param, 0)).toBe(100);
    expect(engine.resolveCurve(param, 1)).toBe(200);
  });

  test("exponential", () => {
    const param = { start: 10, end: 100, curve: 2.0 };
    expect(engine.resolveCurve(param, 0.5)).toBe(10 + 90 * 0.25); // 32.5
  });

  test("clamps progress", () => {
    const param = { start: 5, end: 15, curve: 1 };
    expect(engine.resolveCurve(param, -0.5)).toBe(5);
    expect(engine.resolveCurve(param, 2.0)).toBe(15);
  });
});

describe("getTargetsForDay", () => {
  const profile = {
    flipWeek: 9,
    stretchWks: 2,
    bulkWks: 4,
    ripenWks: 3,
    phases: {
      veg: { basePpm: { start: 35, end: 750, curve: 1.5 } },
      initiation: { basePpm: { start: 662.5, end: 800, curve: 1.0 } },
      bulking: { basePpm: { start: 800, end: 800, curve: 1.0 } },
      ripening: { basePpm: { start: 800, end: 0, curve: 1.0 } },
    },
  };

  test("veg day 1", () => {
    const res = engine.getTargetsForDay(profile, 1);
    expect(res.phase).toBe("VEGETATIVE");
    expect(res.targetPPM).toBeCloseTo(35, 1);
  });

  test("veg last day", () => {
    const res = engine.getTargetsForDay(profile, 56);
    expect(res.targetPPM).toBeCloseTo(750, 1);
  });

  test("initiation day 1", () => {
    const res = engine.getTargetsForDay(profile, 57);
    expect(res.phase).toBe("INITIATION");
    expect(res.targetPPM).toBe(662.5);
  });

  test("ripening flush", () => {
    expect(engine.getTargetsForDay(profile, 118).targetPPM).toBe(0);
    expect(engine.getTargetsForDay(profile, 117).targetPPM).toBe(800);
  });
});

describe("getDynamicTarget", () => {
  const profile = {
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

  test("veg – at target PPFD gives floor", () => {
    const res = engine.getDynamicTarget(profile, 29, 377.27);
    expect(res.targetPPM).toBeCloseTo(294.7, 1);
  });

  test("veg – excess PPFD boosts PPM", () => {
    const res = engine.getDynamicTarget(profile, 29, 575);
    expect(res.targetPPM).toBeCloseTo(393.6, 1);
  });

  test("ripening flush ignores light", () => {
    const res = engine.getDynamicTarget(profile, 118, 1500);
    expect(res.targetPPM).toBe(0);
  });

  test("no sensor uses target PPFD", () => {
    const res = engine.getDynamicTarget(profile, 29, null);
    expect(res.targetPPM).toBeCloseTo(294.7, 1);
  });
});

describe("calculateDeficit", () => {
  test("vegetative day ≤7 uses 1:1:1", () => {
    const res = engine.calculateDeficit(300, 100, "VEGETATIVE", 5, 10);
    expect(res.cal).toBeCloseTo(1.333, 2);
    expect(res.gro).toBeCloseTo(1.222, 2);
    expect(res.micro).toBeCloseTo(1.222, 2);
    expect(res.bloom).toBeCloseTo(1.222, 2);
  });

  test("vegetative day>7 uses 3:2:1", () => {
    const res = engine.calculateDeficit(500, 100, "VEGETATIVE", 14, 18);
    expect(res.cal).toBeCloseTo(1.44, 2);
    expect(res.gro).toBeCloseTo(4.618, 2);
    expect(res.micro).toBeCloseTo(3.079, 2);
    expect(res.bloom).toBeCloseTo(1.539, 2);
  });

  test("initiation uses 1:2:2 and 250 CalMag cap", () => {
    const res = engine.calculateDeficit(800, 200, "INITIATION", 60, 20);
    // Expected values from the same formula as recipeMath.test.js
    const targetPPM = 800;
    const deficitPPM = 200;
    const sysVol = 20;
    const targetCalCap = 250;
    const targetCalPpm = Math.min(targetPPM, targetCalCap); // 250
    const targetBasePpm = targetPPM - targetCalPpm; // 550
    const ratioCal = targetCalPpm / targetPPM; // 0.3125
    const ratioBase = targetBasePpm / targetPPM; // 0.6875
    const deficitCalPpm = deficitPPM * ratioCal; // 62.5
    const deficitBasePpm = deficitPPM * ratioBase; // 137.5
    const calMl = (deficitCalPpm * sysVol) / 375; // (62.5*20)/375 = 3.3333
    const totalBaseMl = (deficitBasePpm * sysVol) / 136.4; // (137.5*20)/136.4 ≈ 20.161
    const partsG = 1,
      partsM = 2,
      partsB = 2;
    const totalParts = 5;
    const mlPerPart = totalBaseMl / totalParts; // 20.161/5 = 4.0322
    const gro = partsG * mlPerPart; // 4.0322
    const micro = partsM * mlPerPart; // 8.0644
    const bloom = partsB * mlPerPart; // 8.0644

    expect(res.cal).toBeCloseTo(calMl, 2);
    expect(res.gro).toBeCloseTo(gro, 2);
    expect(res.micro).toBeCloseTo(micro, 2);
    expect(res.bloom).toBeCloseTo(bloom, 2);
    expect(res.fin).toBe(0);
  });

  test("ripening uses only finisher", () => {
    const res = engine.calculateDeficit(600, 100, "RIPENING", 90, 15);
    expect(res.fin).toBeGreaterThan(0);
    expect(res.gro).toBe(0);
  });

  test("zero target returns zeros", () => {
    const res = engine.calculateDeficit(0, 100, "VEGETATIVE", 10, 18);
    expect(res).toEqual({ cal: 0, gro: 0, micro: 0, bloom: 0, fin: 0 });
  });
});
