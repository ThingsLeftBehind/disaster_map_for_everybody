export { sql } from '@prisma/client/runtime/library';
export type { Sql } from '@prisma/client/runtime/library';
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export * from '@prisma/client';
export type { evac_sites } from '@prisma/client';
