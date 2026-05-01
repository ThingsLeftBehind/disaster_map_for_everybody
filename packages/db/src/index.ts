import { PrismaClient, Prisma } from '@prisma/client';

export const sql = Prisma.sql;
export type Sql = Prisma.Sql;
export { Prisma };

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export * from '@prisma/client';
