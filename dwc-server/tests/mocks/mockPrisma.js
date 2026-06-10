const mockPrisma = {
  telemetryLog: { findFirst: jest.fn(), create: jest.fn() },
  systemState: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
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
module.exports = mockPrisma;
