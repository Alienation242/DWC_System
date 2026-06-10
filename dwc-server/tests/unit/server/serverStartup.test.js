const { _autoSeed } = require("../../../src/server");
const mockPrisma = require("../../../mocks/mockPrisma");
const fs = require("fs").promises;

describe("Server Startup Logic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test("autoSeed creates missing SystemState", async () => {
    mockPrisma.systemState.findUnique.mockResolvedValue(null);
    mockPrisma.systemState.create.mockResolvedValue({ id: 1, currentDay: 1 });
    const state = await _autoSeed();
    expect(mockPrisma.systemState.create).toHaveBeenCalled();
    expect(state.currentDay).toBe(1);
  });

  test("autoSeed does nothing if SystemState already exists", async () => {
    mockPrisma.systemState.findUnique.mockResolvedValue({
      id: 1,
      currentDay: 50,
    });
    const state = await _autoSeed();
    expect(mockPrisma.systemState.create).not.toHaveBeenCalled();
    expect(state.currentDay).toBe(50);
  });
});
