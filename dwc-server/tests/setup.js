process.env.NODE_ENV = "test";

// Mock fs for Prisma client
jest.mock("fs", () => ({
  existsSync: jest.fn(() => true),
  promises: { readFile: jest.fn(), writeFile: jest.fn() },
}));
