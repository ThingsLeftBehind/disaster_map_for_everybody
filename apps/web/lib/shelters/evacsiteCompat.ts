import { Prisma } from 'lib/db/prisma';
import { raw } from '@prisma/client/runtime/library';
import type { Sql } from '@prisma/client/runtime/library';
import { hazardKeys, hazardLabels, type HazardKey } from '@jp-evac/shared';
import { normalizeLatLon } from './coords';
import { factorModeToScale, getEvacSitesSchema } from './evacSitesSchema';
const TABLE_SCHEMA = 'public';

const HAZARD_TABLE_NAME = 'EvacSiteHazardCapability';
const HAZARD_TABLE_REF = `"${TABLE_SCHEMA}"."${HAZARD_TABLE_NAME}"`;

const META_TTL_MS = 10 * 60_000;
const SCALE_TTL_MS = 5 * 60_000;

const CANDIDATE_FACTORS = [1, 1e7, 1e6, 1e5, 1e4, 1e3, 1e2] as const;

type ColumnInfo = {
  name: string;
  dataType: string | null;
  udtName: string | null;
};

type EvacSiteMeta = {
  tableRef: string;
  columns: string[];
  idCol: string;
  idColType: string | null;
  nameCol: string | null;
  addressCol: string | null;
  prefCityCol: string | null;
  prefectureCol: string | null;
  cityCol: string | null;
  municipalityCodeCol: string | null;
  latCol: string;
  lonCol: string;
  isActiveCol: string | null;
  hazardsCol: string | null;
  hazardBoolCols: Partial<Record<(typeof hazardKeys)[number], string>>;
  isSameAddressCol: string | null;
  shelterFieldsCol: string | null;
  notesCol: string | null;
  sourceUpdatedAtCol: string | null;
  createdAtCol: string | null;
  updatedAtCol: string | null;
  commonIdCol: string | null;
};

type EvacSiteHazardMeta = {
  tableRef: string;
  columns: string[];
  siteIdCol: string;
  siteIdColType: string | null;
  hazardKeyCol: string | null;
  enabledCol: string | null;
  hazardsCol: string | null;
  hazardBoolCols: Partial<Record<HazardKey, string>>;
};

export type EvacSiteNormalized = {
  id: string;
  common_id: string | null;
  pref_city: string | null;
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  hazards: Record<string, boolean>;
  is_same_address_as_shelter: boolean | null;
  shelter_fields: unknown | null;
  notes: string | null;
  source_updated_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string;
};

let cachedMeta: { checkedAtMs: number; meta: EvacSiteMeta } | null = null;
let cachedScale: { checkedAtMs: number; factors: number[] } | null = null;
let cachedHazardMeta: { checkedAtMs: number; meta: EvacSiteHazardMeta | null } | null = null;

function nowMs(): number {
  return Date.now();
}

function qIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function pickColumn(columns: string[], candidates: string[]): string | null {
  const byLower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  for (const c of candidates) {
    const hit = byLower.get(c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number.isFinite(Number(value)) ? Number(value) : null;
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

function scoreFactor(samples: Array<{ lat: number; lon: number }>, factor: number): { japanCount: number; validCount: number } {
  let japanCount = 0;
  let validCount = 0;
  for (const s of samples) {
    const lat = factor === 1 ? s.lat : s.lat / factor;
    const lon = factor === 1 ? s.lon : s.lon / factor;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    validCount += 1;
    if (lat >= 20 && lat <= 50 && lon >= 120 && lon <= 150) japanCount += 1;
  }
  return { japanCount, validCount };
}

function rankCoordFactors(samples: Array<{ lat: number; lon: number }>): number[] {
  if (samples.length === 0) return [1];
  const scored = CANDIDATE_FACTORS.map((factor) => ({ factor, ...scoreFactor(samples, factor) }));
  scored.sort((a, b) => b.japanCount - a.japanCount || b.validCount - a.validCount || a.factor - b.factor);
  const ranked = scored.filter((s) => s.validCount > 0).map((s) => s.factor);
  return ranked.length > 0 ? ranked : [1];
}

function safeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === 't' || v === '1') return true;
    if (v === 'false' || v === 'f' || v === '0') return false;
  }
  return null;
}

function safeString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
}

function isUuidType(type: string | null): boolean {
  if (!type) return false;
  const normalized = type.toLowerCase();
  return normalized.includes('uuid');
}

function buildParamForColumn(value: string, columnType: string | null): Sql {
  return isUuidType(columnType) ? Prisma.sql`${value}::uuid` : Prisma.sql`${value}`;
}

function buildParamListForColumn(values: string[], columnType: string | null): Sql {
  return Prisma.join(values.map((value) => buildParamForColumn(value, columnType)));
}

function normalizeColumnInfoRow(row: { column_name: unknown; data_type: unknown; udt_name: unknown }): ColumnInfo | null {
  const name = safeString(row.column_name);
  if (!name) return null;
  return {
    name,
    dataType: safeString(row.data_type),
    udtName: safeString(row.udt_name),
  };
}

function findColumnType(columns: ColumnInfo[] | null, name: string | null): string | null {
  if (!columns || !name) return null;
  const target = name.toLowerCase();
  const hit = columns.find((c) => c.name.toLowerCase() === target);
  if (!hit) return null;
  return (hit.dataType ?? hit.udtName)?.toLowerCase() ?? null;
}

function toCamelCase(input: string): string {
  return input.replace(/_([a-z0-9])/g, (_m, ch: string) => ch.toUpperCase());
}

function capitalize(input: string): string {
  if (!input) return input;
  return input[0].toUpperCase() + input.slice(1);
}

function hazardColumnCandidates(key: HazardKey): string[] {
  const snake = key;
  const noUnderscore = key.replaceAll('_', '');
  const camel = toCamelCase(key);
  const pascal = capitalize(camel);
  return [
    snake,
    noUnderscore,
    camel,
    pascal,
    `hazard_${snake}`,
    `hazard${pascal}`,
    `is_${snake}`,
    `is${pascal}`,
    `${camel}Capable`,
    `${camel}Enabled`,
    `is${pascal}Capable`,
    `is${pascal}Enabled`,
  ];
}

const hazardLabelToKey = new Map<string, HazardKey>(Object.entries(hazardLabels).map(([k, v]) => [v, k as HazardKey]));

function normalizeHazardKey(value: unknown): HazardKey | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const labelHit = hazardLabelToKey.get(trimmed);
    if (labelHit) return labelHit;

    const lower = trimmed.toLowerCase();
    const normalized = lower
      .replace(/\s+/g, '_')
      .replace(/-/g, '_')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase();

    const direct = hazardKeys.find((k) => k.toLowerCase() === normalized) ?? null;
    return direct as HazardKey | null;
  }
  return null;
}

export function isEvacSitesTableMismatchError(error: unknown): boolean {
  const code = (error as any)?.code;
  if (code === 'P2021') return true;
  const message = String((error as any)?.message ?? error ?? '').toLowerCase();
  // Fallback eligibility: keep broad and resilient, because Prisma table/model mismatch
  // errors can vary depending on the runtime context.
  return (
    message.includes('does not exist') ||
    message.includes('not exist') ||
    message.includes('relation') ||
    message.includes('invalid `prisma.') ||
    message.includes('invocation') ||
    /\btable\b/i.test(message)
  );
}

export function redactErrorMessage(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://***');
}

export function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactErrorMessage(raw);
}

async function readInformationSchemaColumnInfo(
  prisma: import('@prisma/client').PrismaClient,
  args: { schema: string; table: string }
): Promise<ColumnInfo[] | null> {
  try {
    const rows = (await prisma.$queryRaw(
      Prisma.sql`
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = ${args.schema} AND table_name = ${args.table}
        ORDER BY ordinal_position
      `
    )) as Array<{ column_name: unknown; data_type: unknown; udt_name: unknown }>;
    const parsed = rows
      .map((row) => normalizeColumnInfoRow(row))
      .filter((v): v is ColumnInfo => Boolean(v));
    return parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function readInformationSchemaColumns(
  prisma: import('@prisma/client').PrismaClient,
  args: { schema: string; table: string }
): Promise<string[] | null> {
  const info = await readInformationSchemaColumnInfo(prisma, args);
  return info ? info.map((c) => c.name) : null;
}

export async function getEvacSiteMeta(prisma: import('@prisma/client').PrismaClient): Promise<EvacSiteMeta> {
  const now = nowMs();
  if (cachedMeta && now - cachedMeta.checkedAtMs < META_TTL_MS) return cachedMeta.meta;

  const schemaResult = await getEvacSitesSchema();
  if (!schemaResult.ok) throw new Error(schemaResult.lastError);

  const columnInfo = await readInformationSchemaColumnInfo(prisma, {
    schema: schemaResult.schema,
    table: schemaResult.relation,
  });
  const columns = columnInfo ? columnInfo.map((c) => c.name) : schemaResult.discoveredColumns;

  if (!columns || columns.length === 0) {
    throw new Error(`Evac sites columns not found. discoveredColumns=${JSON.stringify(schemaResult.discoveredColumns.slice(0, 40))}`);
  }

  const cols = columns;

  const idCol = pickColumn(cols, ['id']) ?? 'id';
  const idColType = findColumnType(columnInfo, idCol);
  const nameCol = pickColumn(cols, ['name', 'site_name', 'shelter_name']);
  const addressCol = pickColumn(cols, ['address', 'addr']);
  const prefCityCol = pickColumn(cols, ['pref_city', 'prefcity', 'prefCity', 'prefecture_city', 'prefectureCity']);
  const prefectureCol = pickColumn(cols, ['prefecture', 'pref_name', 'prefName']);
  const cityCol = pickColumn(cols, ['city', 'muni', 'municipality', 'muni_name', 'muniName']);
  const municipalityCodeCol = pickColumn(cols, ['municipalitycode', 'municipality_code', 'municode', 'muni_code']);
  const latCol = schemaResult.latCol;
  const lonCol = schemaResult.lonCol;
  const isActiveCol = pickColumn(cols, ['isactive', 'is_active', 'active', 'enabled', 'is_enabled']);
  const hazardsCol = pickColumn(cols, ['hazards']);
  const isSameAddressCol = pickColumn(cols, ['is_same_address_as_shelter', 'isSameAddressAsShelter']);
  const shelterFieldsCol = pickColumn(cols, ['shelter_fields', 'shelterFields']);
  const notesCol = pickColumn(cols, ['notes']);
  const sourceUpdatedAtCol = pickColumn(cols, ['source_updated_at', 'sourceUpdatedAt']);
  const createdAtCol = pickColumn(cols, ['created_at', 'createdAt']);
  const updatedAtCol = pickColumn(cols, ['updated_at', 'updatedAt']);
  const commonIdCol = pickColumn(cols, ['common_id', 'commonId']);

  const hazardBoolCols: Partial<Record<(typeof hazardKeys)[number], string>> = {};
  for (const key of hazardKeys) {
    const col = pickColumn(cols, [key, `hazard_${key}`]);
    if (col) hazardBoolCols[key] = col;
  }

  const meta: EvacSiteMeta = {
    tableRef: schemaResult.tableName,
    columns: cols,
    idCol,
    idColType,
    nameCol,
    addressCol,
    prefCityCol,
    prefectureCol,
    cityCol,
    municipalityCodeCol,
    latCol,
    lonCol,
    isActiveCol,
    hazardsCol,
    hazardBoolCols,
    isSameAddressCol,
    shelterFieldsCol,
    notesCol,
    sourceUpdatedAtCol,
    createdAtCol,
    updatedAtCol,
    commonIdCol,
  };

  cachedMeta = { checkedAtMs: now, meta };
  return meta;
}

export async function getEvacSiteHazardMeta(prisma: import('@prisma/client').PrismaClient): Promise<EvacSiteHazardMeta | null> {
  const now = nowMs();
  if (cachedHazardMeta && now - cachedHazardMeta.checkedAtMs < META_TTL_MS) return cachedHazardMeta.meta;

  const columnInfo = await readInformationSchemaColumnInfo(prisma, { schema: TABLE_SCHEMA, table: HAZARD_TABLE_NAME });
  if (!columnInfo) {
    cachedHazardMeta = { checkedAtMs: now, meta: null };
    return null;
  }

  const columns = columnInfo.map((c) => c.name);
  const siteIdCol =
    pickColumn(columns, ['siteid', 'site_id', 'evacsiteid', 'evac_site_id', 'evacsite_id']) ?? null;
  if (!siteIdCol) {
    cachedHazardMeta = { checkedAtMs: now, meta: null };
    return null;
  }

  const siteIdColType = findColumnType(columnInfo, siteIdCol);
  const hazardKeyCol = pickColumn(columns, ['hazardtype', 'hazard_type', 'hazard', 'type', 'kind', 'key', 'hazardkey', 'hazard_key']);
  const enabledCol = pickColumn(columns, [
    'enabled',
    'is_enabled',
    'isenabled',
    'capable',
    'is_capable',
    'iscapable',
    'supported',
    'is_supported',
    'issupported',
    'available',
    'is_available',
    'isavailable',
    'value',
  ]);
  const hazardsCol = pickColumn(columns, ['hazards']);

  const hazardBoolCols: Partial<Record<HazardKey, string>> = {};
  for (const key of hazardKeys) {
    const col = pickColumn(columns, hazardColumnCandidates(key as HazardKey));
    if (col) hazardBoolCols[key as HazardKey] = col;
  }

  const meta: EvacSiteHazardMeta = {
    tableRef: HAZARD_TABLE_REF,
    columns,
    siteIdCol,
    siteIdColType,
    hazardKeyCol,
    enabledCol,
    hazardsCol,
    hazardBoolCols,
  };

  cachedHazardMeta = { checkedAtMs: now, meta };
  return meta;
}

export async function getEvacSiteCoordFactors(prisma: import('@prisma/client').PrismaClient, meta: EvacSiteMeta): Promise<number[]> {
  const now = nowMs();
  if (cachedScale && now - cachedScale.checkedAtMs < SCALE_TTL_MS) return cachedScale.factors;

  const schemaResult = await getEvacSitesSchema();
  if (!schemaResult.ok) throw new Error(schemaResult.lastError);
  const factor = factorModeToScale(schemaResult.factorMode);
  const ranked = [factor];
  cachedScale = { checkedAtMs: now, factors: ranked };
  return ranked;
}

export async function rawCountEvacSites(prisma: import('@prisma/client').PrismaClient, meta: EvacSiteMeta): Promise<number> {
  const table = raw(meta.tableRef);
  const rows = (await prisma.$queryRaw(
    Prisma.sql`SELECT COUNT(*)::bigint AS count FROM ${table}`
  )) as Array<{ count: unknown }>;
  const count = rows[0]?.count;
  return typeof count === 'bigint' ? Number(count) : Number(count ?? 0);
}

export async function rawCountEvacSiteHazardCaps(prisma: import('@prisma/client').PrismaClient, meta: EvacSiteHazardMeta): Promise<number> {
  const table = raw(meta.tableRef);
  const rows = (await prisma.$queryRaw(
    Prisma.sql`SELECT COUNT(*)::bigint AS count FROM ${table}`
  )) as Array<{ count: unknown }>;
  const count = rows[0]?.count;
  return typeof count === 'bigint' ? Number(count) : Number(count ?? 0);
}

export async function rawCountEvacSiteInvalidCoords(
  prisma: import('@prisma/client').PrismaClient,
  meta: EvacSiteMeta,
  factor: number
): Promise<{ nullCount: number; invalidCount: number }> {
  const table = raw(meta.tableRef);
  const latCol = raw(qIdent(meta.latCol));
  const lonCol = raw(qIdent(meta.lonCol));
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const latExpr = f === 1 ? Prisma.sql`${latCol}::double precision` : Prisma.sql`(${latCol}::double precision / ${f})`;
  const lonExpr = f === 1 ? Prisma.sql`${lonCol}::double precision` : Prisma.sql`(${lonCol}::double precision / ${f})`;

  const rows = (await prisma.$queryRaw(
    Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE ${latCol} IS NULL OR ${lonCol} IS NULL)::bigint AS null_count,
        COUNT(*) FILTER (
          WHERE ${latCol} IS NOT NULL AND ${lonCol} IS NOT NULL
            AND (ABS(${latExpr}) > 90 OR ABS(${lonExpr}) > 180)
        )::bigint AS invalid_count
      FROM ${table}
    `
  )) as Array<{ null_count: unknown; invalid_count: unknown }>;
  const nullCount = rows[0]?.null_count;
  const invalidCount = rows[0]?.invalid_count;
  return {
    nullCount: typeof nullCount === 'bigint' ? Number(nullCount) : Number(nullCount ?? 0),
    invalidCount: typeof invalidCount === 'bigint' ? Number(invalidCount) : Number(invalidCount ?? 0),
  };
}

function buildHaversineSql(args: { latExpr: Sql; lonExpr: Sql; lat: number; lon: number }): Sql {
  return Prisma.sql`
    (2 * 6371 * asin(sqrt(
      pow(sin((radians(${args.latExpr}) - radians(${args.lat})) / 2), 2) +
      cos(radians(${args.lat})) * cos(radians(${args.latExpr})) *
      pow(sin((radians(${args.lonExpr}) - radians(${args.lon})) / 2), 2)
    )))
  `;
}

export async function rawCountNearbyEvacSites(
  prisma: import('@prisma/client').PrismaClient,
  meta: EvacSiteMeta,
  args: { lat: number; lon: number; radiusKm: number; factor: number }
): Promise<number> {
  const radiusKm = Math.max(0.1, Math.min(args.radiusKm, 200));
  const factor = Number.isFinite(args.factor) && args.factor > 0 ? args.factor : 1;

  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.max(0.2, Math.cos((args.lat * Math.PI) / 180)));

  const latDb = factor === 1 ? args.lat : Math.round(args.lat * factor);
  const lonDb = factor === 1 ? args.lon : Math.round(args.lon * factor);
  const latDeltaDb = latDelta * factor;
  const lonDeltaDb = lonDelta * factor;

  const table = raw(meta.tableRef);
  const latColRaw = raw(qIdent(meta.latCol));
  const lonColRaw = raw(qIdent(meta.lonCol));
  const activeColRaw = meta.isActiveCol ? raw(qIdent(meta.isActiveCol)) : null;
  const activeClause = activeColRaw ? Prisma.sql`AND ${activeColRaw} = true` : Prisma.sql``;

  const latExpr = factor === 1 ? Prisma.sql`${latColRaw}::double precision` : Prisma.sql`(${latColRaw}::double precision / ${factor})`;
  const lonExpr = factor === 1 ? Prisma.sql`${lonColRaw}::double precision` : Prisma.sql`(${lonColRaw}::double precision / ${factor})`;
  const distanceExpr = buildHaversineSql({ latExpr, lonExpr, lat: args.lat, lon: args.lon });

  const rows = (await prisma.$queryRaw(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT ${distanceExpr} AS distance_km
        FROM ${table}
        WHERE ${latColRaw} >= ${latDb - latDeltaDb} AND ${latColRaw} <= ${latDb + latDeltaDb}
          AND ${lonColRaw} >= ${lonDb - lonDeltaDb} AND ${lonColRaw} <= ${lonDb + lonDeltaDb}
          ${activeClause}
      ) t
      WHERE t.distance_km <= ${radiusKm}
    `
  )) as Array<{ count: unknown }>;
  const count = rows[0]?.count;
  return typeof count === 'bigint' ? Number(count) : Number(count ?? 0);
}

export async function rawNearestDistanceKm(
  prisma: import('@prisma/client').PrismaClient,
  meta: EvacSiteMeta,
  args: { lat: number; lon: number; radiusKm: number; factor: number }
): Promise<number | null> {
  const radiusKm = Math.max(0.1, Math.min(args.radiusKm, 200));
  const factor = Number.isFinite(args.factor) && args.factor > 0 ? args.factor : 1;

  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.max(0.2, Math.cos((args.lat * Math.PI) / 180)));

  const latDb = factor === 1 ? args.lat : Math.round(args.lat * factor);
  const lonDb = factor === 1 ? args.lon : Math.round(args.lon * factor);
  const latDeltaDb = latDelta * factor;
  const lonDeltaDb = lonDelta * factor;

  const table = raw(meta.tableRef);
  const latColRaw = raw(qIdent(meta.latCol));
  const lonColRaw = raw(qIdent(meta.lonCol));
  const activeColRaw = meta.isActiveCol ? raw(qIdent(meta.isActiveCol)) : null;
  const activeClause = activeColRaw ? Prisma.sql`AND ${activeColRaw} = true` : Prisma.sql``;

  const latExpr = factor === 1 ? Prisma.sql`${latColRaw}::double precision` : Prisma.sql`(${latColRaw}::double precision / ${factor})`;
  const lonExpr = factor === 1 ? Prisma.sql`${lonColRaw}::double precision` : Prisma.sql`(${lonColRaw}::double precision / ${factor})`;
  const distanceExpr = buildHaversineSql({ latExpr, lonExpr, lat: args.lat, lon: args.lon });

  const rows = (await prisma.$queryRaw(
    Prisma.sql`
      SELECT distance_km
      FROM (
        SELECT ${distanceExpr} AS distance_km
        FROM ${table}
        WHERE ${latColRaw} >= ${latDb - latDeltaDb} AND ${latColRaw} <= ${latDb + latDeltaDb}
          AND ${lonColRaw} >= ${lonDb - lonDeltaDb} AND ${lonColRaw} <= ${lonDb + lonDeltaDb}
          ${activeClause}
      ) t
      WHERE t.distance_km <= ${radiusKm}
      ORDER BY t.distance_km ASC
      LIMIT 1
    `
  )) as Array<{ distance_km: unknown }>;
  const v = rows[0]?.distance_km;
  const n = typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function rawSampleShelter(
  prisma: import('@prisma/client').PrismaClient,
  meta: EvacSiteMeta
): Promise<{ id: string; name: string } | null> {
  const table = raw(meta.tableRef);
  const idCol = raw(qIdent(meta.idCol));
  const nameCol = meta.nameCol ? raw(qIdent(meta.nameCol)) : null;
  const rows = (await prisma.$queryRaw(
    Prisma.sql`
      SELECT ${idCol} AS id, ${nameCol ?? raw('NULL')} AS name
      FROM ${table}
      LIMIT 1
    `
  )) as Array<{ id: unknown; name: unknown }>;
  if (!rows[0]?.id) return null;
  return { id: String(rows[0].id), name: typeof rows[0].name === 'string' ? rows[0].name : '' };
}

export async function rawFindById(prisma: import('@prisma/client').PrismaClient, meta: EvacSiteMeta, id: string): Promise<Record<string, unknown> | null> {
  const table = raw(meta.tableRef);
  const idCol = raw(qIdent(meta.idCol));
  const idParam = buildParamForColumn(id, meta.idColType);
  const rows = (await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM ${table}
      WHERE ${idCol} = ${idParam}
      LIMIT 1
    `
  )) as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

export async function rawFindByIds(prisma: import('@prisma/client').PrismaClient, meta: EvacSiteMeta, ids: string[]): Promise<Array<Record<string, unknown>>> {
  const unique = Array.from(new Set(ids)).filter(Boolean).slice(0, 50);
  if (unique.length === 0) return [];
  const table = raw(meta.tableRef);
  const idCol = raw(qIdent(meta.idCol));
  const idParams = buildParamListForColumn(unique, meta.idColType);
  const rows = (await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM ${table}
      WHERE ${idCol} IN (${idParams})
    `
  )) as Array<Record<string, unknown>>;
  return rows;
}

export async function rawFindInBoundingBox(prisma: import('@prisma/client').PrismaClient, meta: EvacSiteMeta, args: { latMin: number; latMax: number; lonMin: number; lonMax: number; take: number }): Promise<Array<Record<string, unknown>>> {
  const table = raw(meta.tableRef);
  const latCol = raw(qIdent(meta.latCol));
  const lonCol = raw(qIdent(meta.lonCol));
  const take = Math.max(1, Math.min(args.take, 5000));
  const isActiveCol = meta.isActiveCol ? raw(qIdent(meta.isActiveCol)) : null;
  const isActiveClause = isActiveCol ? Prisma.sql`AND ${isActiveCol} = true` : Prisma.sql``;
  const rows = (await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM ${table}
      WHERE ${latCol} >= ${args.latMin} AND ${latCol} <= ${args.latMax}
        AND ${lonCol} >= ${args.lonMin} AND ${lonCol} <= ${args.lonMax}
        ${isActiveClause}
      LIMIT ${take}
    `
  )) as Array<Record<string, unknown>>;
  return rows;
}

export async function rawFindAny(prisma: import('@prisma/client').PrismaClient, meta: EvacSiteMeta, take: number): Promise<Array<Record<string, unknown>>> {
  const table = raw(meta.tableRef);
  const orderCol = raw(qIdent(meta.updatedAtCol ?? meta.createdAtCol ?? meta.idCol));
  const isActiveCol = meta.isActiveCol ? raw(qIdent(meta.isActiveCol)) : null;
  const isActiveClause = isActiveCol ? Prisma.sql`WHERE ${isActiveCol} = true` : Prisma.sql``;
  const rows = (await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM ${table}
      ${isActiveClause}
      ORDER BY ${orderCol} DESC NULLS LAST
      LIMIT ${Math.max(1, Math.min(take, 5000))}
    `
  )) as Array<Record<string, unknown>>;
  return rows;
}

export async function rawLoadHazardCapsBySiteIds(
  prisma: import('@prisma/client').PrismaClient,
  meta: EvacSiteHazardMeta | null,
  siteIds: string[]
): Promise<Map<string, Record<string, boolean>>> {
  const ids = Array.from(new Set(siteIds)).filter(Boolean).slice(0, 2000);
  const out = new Map<string, Record<string, boolean>>();
  if (!meta || ids.length === 0) return out;

  const table = raw(meta.tableRef);
  const siteIdCol = raw(qIdent(meta.siteIdCol));
  const idParams = buildParamListForColumn(ids, meta.siteIdColType);

  const rows = (await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM ${table}
      WHERE ${siteIdCol} IN (${idParams})
    `
  )) as Array<Record<string, unknown>>;

  const hasBoolCols = Object.keys(meta.hazardBoolCols).length > 0;

  for (const row of rows) {
    const siteIdRaw = row[meta.siteIdCol];
    if (siteIdRaw === null || siteIdRaw === undefined) continue;
    const siteId = String(siteIdRaw);
    const current = out.get(siteId) ?? {};

    if (meta.hazardsCol) {
      const raw = row[meta.hazardsCol];
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw as any)) {
          const hk = normalizeHazardKey(k);
          if (!hk) continue;
          current[hk] = current[hk] || Boolean(v);
        }
      }
    }

    if (hasBoolCols) {
      for (const key of hazardKeys) {
        const col = meta.hazardBoolCols[key as HazardKey];
        if (!col) continue;
        const b = safeBoolean(row[col]);
        if (b === true) current[key] = true;
      }
    } else if (meta.hazardKeyCol) {
      const hk = normalizeHazardKey(row[meta.hazardKeyCol]);
      if (hk) {
        const enabled = meta.enabledCol ? safeBoolean(row[meta.enabledCol]) : true;
        if (enabled === true) current[hk] = true;
      }
    }

    out.set(siteId, current);
  }

  return out;
}

export async function rawSearchEvacSites(
  prisma: import('@prisma/client').PrismaClient,
  meta: EvacSiteMeta,
  args: {
    prefCode?: string | null;
    prefName?: string | null;
    muniName?: string | null;
    muniCode?: string | null;
    q?: string | null;
    limit: number;
    offset: number;
  }
): Promise<Array<Record<string, unknown>>> {
  const table = raw(meta.tableRef);
  const orderCol = raw(qIdent(meta.updatedAtCol ?? meta.createdAtCol ?? meta.idCol));

  const conditions: Sql[] = [];

  const prefCodeRaw = typeof args.prefCode === 'string' ? args.prefCode.trim() : '';
  const prefCodeFromMuni =
    !prefCodeRaw && args.muniCode && /^\d{6}$/.test(args.muniCode) ? args.muniCode.slice(0, 2) : null;
  const prefCode = prefCodeRaw && /^\d{2}$/.test(prefCodeRaw) ? prefCodeRaw : prefCodeFromMuni;

  const prefName = (args.prefName ?? '').trim();
  if (prefName) {
    const patternStart = `${prefName}%`;
    const patternContains = `%${prefName}%`;
    const ors: Sql[] = [];
    if (meta.prefCityCol) {
      const c = raw(qIdent(meta.prefCityCol));
      ors.push(Prisma.sql`${c} ILIKE ${patternStart}`);
    }
    if (meta.addressCol) {
      const c = raw(qIdent(meta.addressCol));
      ors.push(Prisma.sql`${c} ILIKE ${patternStart}`);
      ors.push(Prisma.sql`${c} ILIKE ${patternContains}`);
    }
    if (meta.prefectureCol) {
      const c = raw(qIdent(meta.prefectureCol));
      ors.push(Prisma.sql`${c} ILIKE ${patternContains}`);
    }
    if (ors.length > 0) conditions.push(Prisma.sql`(${Prisma.join(ors, ' OR ')})`);
  }

  const muniName = (args.muniName ?? '').trim();
  if (muniName) {
    const patternContains = `%${muniName}%`;
    const ors: Sql[] = [];
    if (meta.prefCityCol) {
      const c = raw(qIdent(meta.prefCityCol));
      ors.push(Prisma.sql`${c} ILIKE ${patternContains}`);
    }
    if (meta.addressCol) {
      const c = raw(qIdent(meta.addressCol));
      ors.push(Prisma.sql`${c} ILIKE ${patternContains}`);
    }
    if (meta.cityCol) {
      const c = raw(qIdent(meta.cityCol));
      ors.push(Prisma.sql`${c} ILIKE ${patternContains}`);
    }
    if (ors.length > 0) conditions.push(Prisma.sql`(${Prisma.join(ors, ' OR ')})`);
  } else {
    const muniCode = (args.muniCode ?? '').trim();
    if (muniCode) {
      if (meta.municipalityCodeCol) {
        const c = raw(qIdent(meta.municipalityCodeCol));
        conditions.push(Prisma.sql`${c} = ${muniCode}`);
        // If an explicit municipality code column exists, prefer exact filtering (fast, reliable).
      } else {
        const patternContains = `%${muniCode}%`;
        const ors: Sql[] = [];
        if (meta.prefCityCol) {
          const c = raw(qIdent(meta.prefCityCol));
          ors.push(Prisma.sql`${c} ILIKE ${patternContains}`);
        }
        if (meta.addressCol) {
          const c = raw(qIdent(meta.addressCol));
          ors.push(Prisma.sql`${c} ILIKE ${patternContains}`);
        }
        if (meta.commonIdCol) {
          const c = raw(qIdent(meta.commonIdCol));
          ors.push(Prisma.sql`${c} ILIKE ${patternContains}`);
        }
        if (ors.length > 0) conditions.push(Prisma.sql`(${Prisma.join(ors, ' OR ')})`);
      }
    }
  }

  if (prefCode && meta.municipalityCodeCol) {
    const c = raw(qIdent(meta.municipalityCodeCol));
    conditions.push(Prisma.sql`${c} LIKE ${`${prefCode}%`}`);
  }

  const q = (args.q ?? '').trim();
  if (q) {
    const patternContains = `%${q}%`;
    const ors: Sql[] = [];
    if (meta.nameCol) {
      const c = raw(qIdent(meta.nameCol));
      ors.push(Prisma.sql`${c} ILIKE ${patternContains}`);
    }
    if (meta.addressCol) {
      const c = raw(qIdent(meta.addressCol));
      ors.push(Prisma.sql`${c} ILIKE ${patternContains}`);
    }
    if (meta.notesCol) {
      const c = raw(qIdent(meta.notesCol));
      ors.push(Prisma.sql`${c} ILIKE ${patternContains}`);
    }
    if (ors.length > 0) conditions.push(Prisma.sql`(${Prisma.join(ors, ' OR ')})`);
  }

  const whereSql = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.sql``;
  const limit = Math.max(1, Math.min(args.limit, 100));
  const offset = Math.max(0, Math.min(args.offset, 10_000));

  const isActiveCol = meta.isActiveCol ? raw(qIdent(meta.isActiveCol)) : null;
  const isActiveClause = isActiveCol
    ? conditions.length > 0
      ? Prisma.sql`AND ${isActiveCol} = true`
      : Prisma.sql`WHERE ${isActiveCol} = true`
    : Prisma.sql``;

  const rows = (await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM ${table}
      ${whereSql}
      ${isActiveClause}
      ORDER BY ${orderCol} DESC NULLS LAST
      LIMIT ${limit}
      OFFSET ${offset}
    `
  )) as Array<Record<string, unknown>>;
  return rows;
}

export async function getEvacSiteDbDiagnostics(
  prisma: import('@prisma/client').PrismaClient
): Promise<{
  evacSite: { columns: string[] | null; count: number; nullCoords: number; invalidCoords: number };
  hazardCaps: { columns: string[] | null; count: number };
}> {
  const schemaResult = await getEvacSitesSchema();
  if (!schemaResult.ok) throw new Error(schemaResult.lastError);

  const evacColumns = await readInformationSchemaColumns(prisma, {
    schema: schemaResult.schema,
    table: schemaResult.relation,
  });
  const hazardColumns = await readInformationSchemaColumns(prisma, { schema: TABLE_SCHEMA, table: HAZARD_TABLE_NAME });

  const evacMeta = await getEvacSiteMeta(prisma);
  const factors = await getEvacSiteCoordFactors(prisma, evacMeta);
  const factor = factors[0] ?? 1;

  const evacCount = await rawCountEvacSites(prisma, evacMeta);
  const { nullCount, invalidCount } = await rawCountEvacSiteInvalidCoords(prisma, evacMeta, factor);

  let hazardCount = 0;
  if (hazardColumns) {
    const hazardMeta = await getEvacSiteHazardMeta(prisma);
    if (hazardMeta) hazardCount = await rawCountEvacSiteHazardCaps(prisma, hazardMeta);
  }

  return {
    evacSite: { columns: evacColumns, count: evacCount, nullCoords: nullCount, invalidCoords: invalidCount },
    hazardCaps: { columns: hazardColumns, count: hazardCount },
  };
}

export function normalizeEvacSiteRow(
  row: Record<string, unknown>,
  meta: EvacSiteMeta,
  factorCandidates: number[]
): EvacSiteNormalized | null {
  const idRaw = row[meta.idCol];
  if (idRaw === null || idRaw === undefined) return null;
  const id = String(idRaw);

  const nameRaw = meta.nameCol ? row[meta.nameCol] : null;
  const name = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw : '名称不明';

  const address = meta.addressCol ? safeString(row[meta.addressCol]) : null;

  let prefCity: string | null = meta.prefCityCol ? safeString(row[meta.prefCityCol]) : null;
  if (!prefCity) {
    const pref = meta.prefectureCol ? safeString(row[meta.prefectureCol]) : null;
    const city = meta.cityCol ? safeString(row[meta.cityCol]) : null;
    if (pref && city) prefCity = `${pref}${city}`;
    else if (pref) prefCity = pref;
  }

  const commonId = meta.commonIdCol ? safeString(row[meta.commonIdCol]) : null;

  const coords =
    factorCandidates
      .map((factor) =>
        normalizeLatLon({
          lat: row[meta.latCol],
          lon: row[meta.lonCol],
          factor,
        })
      )
      .find(Boolean) ?? null;
  if (!coords) return null;

  let hazards: Record<string, boolean> = {};
  if (meta.hazardsCol) {
    const raw = row[meta.hazardsCol];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) hazards = raw as any;
  } else {
    hazards = {};
    for (const key of hazardKeys) {
      const col = meta.hazardBoolCols[key];
      if (!col) continue;
      hazards[key] = Boolean(row[col]);
    }
  }

  const isSame = meta.isSameAddressCol ? safeBoolean(row[meta.isSameAddressCol]) : null;
  const shelterFields = meta.shelterFieldsCol ? (row[meta.shelterFieldsCol] ?? null) : null;
  const notes = meta.notesCol ? safeString(row[meta.notesCol]) : null;
  const sourceUpdatedAt = meta.sourceUpdatedAtCol ? (row[meta.sourceUpdatedAtCol] as any) : null;
  const createdAt = meta.createdAtCol ? (row[meta.createdAtCol] as any) : null;
  const updatedAt = meta.updatedAtCol ? (row[meta.updatedAtCol] as any) : createdAt ?? new Date().toISOString();

  return {
    id,
    common_id: commonId,
    pref_city: prefCity,
    name,
    address,
    lat: coords.lat,
    lon: coords.lon,
    hazards,
    is_same_address_as_shelter: isSame,
    shelter_fields: shelterFields,
    notes,
    source_updated_at: sourceUpdatedAt,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}
