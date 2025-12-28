import { prisma } from 'lib/db/prisma';

export type FactorMode = 'FLOAT' | 'E6' | 'E7';

export type EvacSitesSchemaOk = {
  ok: true;
  schema: string;
  relation: string;
  tableName: string;
  latCol: string;
  lonCol: string;
  factorMode: FactorMode;
  discoveredColumns: string[];
  candidates: { lat: string[]; lon: string[] };
};

export type EvacSitesSchemaDown = {
  ok: false;
  fetchStatus: 'DOWN';
  lastError: string;
  diagnostics?: any;
};

export type EvacSitesSchemaResult = EvacSitesSchemaOk | EvacSitesSchemaDown;

const RELATION_CANDIDATES = ['evac_sites', 'EvacSite', 'evacsite', 'evac_site', 'evacSites'] as const;
const LAT_CANDIDATES = ['latitude', 'lat', 'ido', 'y', 'lat_deg', 'y_deg', 'lat_e7', 'lat_e6'] as const;
const LON_CANDIDATES = ['longitude', 'lon', 'lng', 'keido', 'x', 'lon_deg', 'x_deg', 'lon_e7', 'lon_e6'] as const;

const CACHE_TTL_MS = 5 * 60_000;
let cached: { checkedAtMs: number; value: EvacSitesSchemaResult } | null = null;

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function redactErrorMessage(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://***');
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  try {
    const n = Number(value as any);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function pickColumn(columns: string[], candidates: readonly string[]): string | null {
  const byLower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  for (const candidate of candidates) {
    const hit = byLower.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function buildSchemaError(message: string, columns: string[]): EvacSitesSchemaDown {
  const preview = columns.slice(0, 40);
  const candidates = { lat: [...LAT_CANDIDATES], lon: [...LON_CANDIDATES] };
  const detail = `discoveredColumns=${JSON.stringify(preview)} candidates=${JSON.stringify(candidates)}`;
  return {
    ok: false,
    fetchStatus: 'DOWN',
    lastError: `${message} ${detail}`,
    items: [],
    diagnostics: { discoveredColumns: preview, candidates },
  } as EvacSitesSchemaDown;
}

export function factorModeToScale(mode: FactorMode): number {
  if (mode === 'E6') return 1e6;
  if (mode === 'E7') return 1e7;
  return 1;
}

export function toStoredCoord(value: number, mode: FactorMode): number {
  const factor = factorModeToScale(mode);
  return factor === 1 ? value : Math.round(value * factor);
}

export function fromStoredCoord(value: number, mode: FactorMode): number {
  const factor = factorModeToScale(mode);
  return factor === 1 ? value : value / factor;
}

function decideFactorMode(samples: Array<{ lat: number; lon: number }>): FactorMode | null {
  if (samples.length === 0) return null;
  const majority = Math.floor(samples.length / 2) + 1;
  let floatCount = 0;
  let e6Count = 0;
  let e7Count = 0;
  for (const s of samples) {
    const lat = Math.abs(s.lat);
    const lon = Math.abs(s.lon);
    if (lat <= 90 && lon <= 180) floatCount += 1;
    if (lat <= 90e6 && lon <= 180e6) e6Count += 1;
    if (lat <= 90e7 && lon <= 180e7) e7Count += 1;
  }
  if (floatCount >= majority) return 'FLOAT';
  if (e6Count >= majority) return 'E6';
  if (e7Count >= majority) return 'E7';
  return null;
}

async function readRelationCandidates(): Promise<Array<{ schema: string; relation: string; relkind: string }>> {
  const rows = (await prisma.$queryRaw`
    SELECT n.nspname AS schema, c.relname AS relation, c.relkind AS relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = ANY(${RELATION_CANDIDATES}::text[])
      AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
  `) as Array<{ schema: unknown; relation: unknown; relkind: unknown }>;

  return rows
    .map((row) => ({
      schema: String(row.schema ?? ''),
      relation: String(row.relation ?? ''),
      relkind: String(row.relkind ?? ''),
    }))
    .filter((row) => row.schema && row.relation);
}

function pickRelation(rows: Array<{ schema: string; relation: string }>): { schema: string; relation: string } | null {
  for (const candidate of RELATION_CANDIDATES) {
    const matches = rows.filter((row) => row.relation === candidate);
    if (matches.length === 0) continue;
    const publicMatch = matches.find((row) => row.schema === 'public');
    return publicMatch ?? matches[0];
  }
  return null;
}

async function readColumns(schema: string, relation: string): Promise<string[]> {
  const rows = (await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = ${relation}
    ORDER BY ordinal_position
  `) as Array<{ column_name: unknown }>;

  return rows.map((row) => String(row.column_name ?? '')).filter(Boolean);
}

async function readSampleCoords(args: { schema: string; relation: string; latCol: string; lonCol: string }): Promise<Array<{ lat: number; lon: number }>> {
  const tableName = `${quoteIdent(args.schema)}.${quoteIdent(args.relation)}`;
  const latIdent = quoteIdent(args.latCol);
  const lonIdent = quoteIdent(args.lonCol);
  const sql = `
    SELECT ${latIdent}::double precision AS lat,
           ${lonIdent}::double precision AS lon
    FROM ${tableName}
    WHERE ${latIdent} IS NOT NULL AND ${lonIdent} IS NOT NULL
    LIMIT 25
  `;
  const rows = (await prisma.$queryRawUnsafe(sql)) as Array<{ lat: unknown; lon: unknown }>;
  return rows
    .map((row) => {
      const lat = toFiniteNumber(row.lat);
      const lon = toFiniteNumber(row.lon);
      if (lat === null || lon === null) return null;
      return { lat, lon };
    })
    .filter((v): v is { lat: number; lon: number } => Boolean(v));
}

export async function getEvacSitesSchema(): Promise<EvacSitesSchemaResult> {
  const now = Date.now();
  if (cached && now - cached.checkedAtMs < CACHE_TTL_MS) return cached.value;

  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim().length === 0) {
    const down = {
      ok: false,
      fetchStatus: 'DOWN',
      lastError: 'DATABASE_URL is not set in runtime environment (Vercel).',
      items: [],
      diagnostics: { reason: 'ENV_MISSING' },
    } as EvacSitesSchemaDown;
    cached = { checkedAtMs: now, value: down };
    return down;
  }

  try {
    const relationRows = await readRelationCandidates();
    const picked = pickRelation(relationRows);
    if (!picked) {
      const down = buildSchemaError('Evac sites relation not found.', []);
      cached = { checkedAtMs: now, value: down };
      return down;
    }

    const discoveredColumns = await readColumns(picked.schema, picked.relation);
    if (discoveredColumns.length === 0) {
      const down = buildSchemaError('Evac sites columns not found.', []);
      cached = { checkedAtMs: now, value: down };
      return down;
    }

    const latCol = pickColumn(discoveredColumns, LAT_CANDIDATES);
    const lonCol = pickColumn(discoveredColumns, LON_CANDIDATES);
    if (!latCol || !lonCol) {
      const down = buildSchemaError('Evac sites lat/lon columns not found.', discoveredColumns);
      cached = { checkedAtMs: now, value: down };
      return down;
    }

    const samples = await readSampleCoords({ schema: picked.schema, relation: picked.relation, latCol, lonCol });
    const factorMode = decideFactorMode(samples);
    if (!factorMode) {
      const down = buildSchemaError('Evac sites coord factor mode could not be determined.', discoveredColumns);
      cached = { checkedAtMs: now, value: down };
      return down;
    }

    const result: EvacSitesSchemaOk = {
      ok: true,
      schema: picked.schema,
      relation: picked.relation,
      tableName: `${quoteIdent(picked.schema)}.${quoteIdent(picked.relation)}`,
      latCol,
      lonCol,
      factorMode,
      discoveredColumns,
      candidates: { lat: [...LAT_CANDIDATES], lon: [...LON_CANDIDATES] },
    };
    cached = { checkedAtMs: now, value: result };
    return result;
  } catch (error) {
    const message = redactErrorMessage(String((error as any)?.message ?? error ?? 'Unknown error'));
    const down = buildSchemaError(`Evac sites schema lookup failed: ${message}.`, []);
    cached = { checkedAtMs: now, value: down };
    return down;
  }
}
