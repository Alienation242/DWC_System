process.env.NODE_ENV = "test";

// Complete mock of fs to satisfy Prisma client's sync reads
jest.mock("fs", () => ({
  readFileSync: jest.fn(() => Buffer.from("{}")),
  existsSync: jest.fn(() => true),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
}));

// Create the mock Prisma client
const mockPrisma = {
  telemetryLog: { findFirst: jest.fn(), create: jest.fn() },
  systemState: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  batchState: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  watchdogConfig: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
  },
  doseLog: { findFirst: jest.fn(), aggregate: jest.fn(), create: jest.fn() },
  $disconnect: jest.fn(),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

// Make mockPrisma available globally in all tests
global.mockPrisma = mockPrisma;
