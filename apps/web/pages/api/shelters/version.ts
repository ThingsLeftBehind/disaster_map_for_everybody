import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma } from '@prisma/client';
import { prisma } from 'lib/db/prisma';
import { getEvacSitesSchema } from 'lib/shelters/evacSitesSchema';

type VersionResponse = {
  fetchStatus: 'OK' | 'UNAVAILABLE';
  updatedAt: string | null;
  version: string | null;
  count?: number | null;
  lastError?: string | null;
};

const UPDATED_COL_CANDIDATES = ['updated_at', 'updatedAt', 'source_updated_at', 'sourceUpdatedAt'];

export default async function handler(req: NextApiRequest, res: NextApiResponse<VersionResponse>) {
  if (req.method !== 'GET') {
    return res.status(405).json({ fetchStatus: 'UNAVAILABLE', updatedAt: null, version: null, lastError: 'Method not allowed' });
  }

  const schemaResult = await getEvacSitesSchema();
  if (!schemaResult.ok) {
    return res.status(200).json({
      fetchStatus: 'UNAVAILABLE',
      updatedAt: null,
      version: null,
      lastError: schemaResult.lastError ?? 'Schema unavailable',
    });
  }

  try {
    const table = Prisma.raw(schemaResult.tableName);
    const updatedCol = pickUpdatedColumn(schemaResult.discoveredColumns ?? []);

    let row: Record<string, unknown> = {};
    if (updatedCol) {
      const col = Prisma.raw(qIdent(updatedCol));
      const rows = (await prisma.$queryRaw(
        Prisma.sql`SELECT COUNT(*)::bigint as count, MAX(${col}) as updated_at FROM ${table}`
      )) as Array<Record<string, unknown>>;
      row = rows[0] ?? {};
    } else {
      const rows = (await prisma.$queryRaw(
        Prisma.sql`SELECT COUNT(*)::bigint as count FROM ${table}`
      )) as Array<Record<string, unknown>>;
      row = rows[0] ?? {};
    }

    const count = toNumber(row.count);
    const updatedAtIso = toIso(row.updated_at ?? row.updatedAt ?? null);
    const version = updatedAtIso ? `${updatedAtIso}:${count}` : `count:${count}`;

    return res.status(200).json({
      fetchStatus: 'OK',
      updatedAt: updatedAtIso,
      version,
      count,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(200).json({
      fetchStatus: 'UNAVAILABLE',
      updatedAt: null,
      version: null,
      lastError: message,
    });
  }
}

function pickUpdatedColumn(columns: string[]) {
  const lower = columns.map((col) => col.toLowerCase());
  for (const candidate of UPDATED_COL_CANDIDATES) {
    const idx = lower.indexOf(candidate.toLowerCase());
    if (idx >= 0) return columns[idx];
  }
  return null;
}

function qIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
