const mockPrisma = {
  telemetryLog: { findFirst: jest.fn(), create: jest.fn() },
  systemState: { findFirst: jest.fn(), update: jest.fn() },
  batchState: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
  watchdogConfig: {
    findUnique: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
    findMany: jest.fn(),
  },
  doseLog: { findFirst: jest.fn(), aggregate: jest.fn(), create: jest.fn() },
  $disconnect: jest.fn(),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

module.exports = mockPrisma;
