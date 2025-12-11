import { PrismaClient } from '@prisma/client';

type GlobalPrisma = typeof globalThis & { prisma?: PrismaClient };

const globalRef = globalThis as GlobalPrisma;

export const prisma = globalRef.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalRef.prisma = prisma;
}

export * from '@prisma/client';
