
import type { PrismaClient } from '@jp-evac/db';
import { Prisma } from '@prisma/client';
import type { Sql } from '@prisma/client/runtime/library';
import { sqltag as sql, join, raw } from '@prisma/client/runtime/library';
import { haversineDistance } from '@jp-evac/shared';
import {
  getEvacSiteCoordFactors,
  getEvacSiteHazardMeta,
  getEvacSiteMeta,
  normalizeEvacSiteRow,
  rawCountEvacSiteHazardCaps,
  rawCountEvacSites,
  rawCountNearbyEvacSites,
  rawFindById,
  rawFindByIds,
  rawLoadHazardCapsBySiteIds,
  rawSampleShelter,
  rawSearchEvacSites,
  type EvacSiteNormalized,
} from 'lib/shelters/evacsiteCompat';

type EvacSiteMeta = Awaited<ReturnType<typeof getEvacSiteMeta>>;
type EvacSiteHazardMeta = Awaited<ReturnType<typeof getEvacSiteHazardMeta>>;

const BASE_SCALE_FACTORS = [1, 1e7, 1e6, 1e5, 1e4, 1e3, 1e2] as const;

export type ShelterFallbackContext = {
  meta: EvacSiteMeta;
  hazardMeta: EvacSiteHazardMeta;
  factors: number[];
  factor: number;
};

export type NearbyFallbackSite = EvacSiteNormalized & {
  distanceKm: number;
  distance: number;
  matchesHazards: boolean;
  missingHazards: string[];
};

export type NearbyFallbackDiagnostics = {
  minDistanceKm: number | null;
  countWithin1Km: number;
  countWithin5Km: number;
};

export type ShelterHealthFallback = {
  context: ShelterFallbackContext;
  sheltersCount: number;
  hazardCapsCount: number;
  nearbySampleCount: number;
  sampleShelter: { id: string; name: string } | null;
};

export type ShelterByIdFallback = {
  site: EvacSiteNormalized | null;
  found: boolean;
};

function qIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
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

function buildHaversineSql(args: { latExpr: Sql; lonExpr: Sql; lat: number; lon: number }): Sql {
  return Prisma.sql`
    (2 * 6371 * asin(sqrt(
      pow(sin((radians(${args.latExpr}) - radians(${args.lat})) / 2), 2) +
      cos(radians(${args.lat})) * cos(radians(${args.latExpr})) *
      pow(sin((radians(${args.lonExpr}) - radians(${args.lon})) / 2), 2)
    )))
  `;
}

function mergeScaleCandidates(primary: number[]): number[] {
  const merged: number[] = [];
  const seen = new Set<number>();
  for (const factor of [...primary, ...BASE_SCALE_FACTORS]) {
    if (!Number.isFinite(factor) || factor <= 0) continue;
    if (seen.has(factor)) continue;
    seen.add(factor);
    merged.push(factor);
  }
  return merged.length > 0 ? merged : [1];
}

type ScaleClause = { bbox: Sql; distanceExpr: Sql };

function buildScaleClauses(args: {
  latCol: Sql;
  lonCol: Sql;
  lat: number;
  lon: number;
  radiusKm: number;
  factors: number[];
}): ScaleClause[] {
  const latDelta = args.radiusKm / 111.32;
  const lonDelta = args.radiusKm / (111.32 * Math.max(0.2, Math.cos((args.lat * Math.PI) / 180)));

  return args.factors.map((factor) => {
    const latDb = args.lat * factor;
    const lonDb = args.lon * factor;
    const latDeltaDb = latDelta * factor;
    const lonDeltaDb = lonDelta * factor;

    const bbox = Prisma.sql`
      ${args.latCol} >= ${latDb - latDeltaDb} AND ${args.latCol} <= ${latDb + latDeltaDb}
      AND ${args.lonCol} >= ${lonDb - lonDeltaDb} AND ${args.lonCol} <= ${lonDb + lonDeltaDb}
    `;

    const latExpr =
      factor === 1 ? Prisma.sql`${args.latCol}::double precision` : Prisma.sql`(${args.latCol}::double precision / ${factor})`;
    const lonExpr =
      factor === 1 ? Prisma.sql`${args.lonCol}::double precision` : Prisma.sql`(${args.lonCol}::double precision / ${factor})`;
    const distanceExpr = buildHaversineSql({ latExpr, lonExpr, lat: args.lat, lon: args.lon });

    return { bbox, distanceExpr };
  });
}

function buildDiagnostics(items: Array<{ distanceKm: number }>): NearbyFallbackDiagnostics {
  const distances = items.map((s) => s.distanceKm).filter((v) => Number.isFinite(v));
  const topDistances = distances.slice(0, 50);
  const minDistanceKm = topDistances.length > 0 ? Math.min(...topDistances) : null;
  const countWithin1Km = distances.filter((d) => d <= 1).length;
  const countWithin5Km = distances.filter((d) => d <= 5).length;
  return { minDistanceKm, countWithin1Km, countWithin5Km };
}

async function getFallbackContext(prisma: PrismaClient): Promise<ShelterFallbackContext> {
  const meta = await getEvacSiteMeta(prisma);
  const hazardMeta = await getEvacSiteHazardMeta(prisma);
  const factors = await getEvacSiteCoordFactors(prisma, meta);
  const factor = factors[0] ?? 1;
  return { meta, hazardMeta, factors, factor };
}

async function applyHazardCaps(
  prisma: PrismaClient,
  hazardMeta: EvacSiteHazardMeta,
  sites: EvacSiteNormalized[]
): Promise<EvacSiteNormalized[]> {
  const hazardMap = await rawLoadHazardCapsBySiteIds(
    prisma,
    hazardMeta,
    sites.map((s) => s.id)
  );

  return sites.map((site) => ({
    ...site,
    hazards: hazardMap.get(site.id) ?? (site.hazards ?? {}),
  }));
}

export async function fallbackFindShelterById(prisma: PrismaClient, id: string): Promise<ShelterByIdFallback> {
  const context = await getFallbackContext(prisma);
  const row = await rawFindById(prisma, context.meta, id);
  if (!row) return { site: null, found: false };
  const normalized = normalizeEvacSiteRow(row, context.meta, context.factors);
  if (!normalized) return { site: null, found: true };

  const hazardMap = await rawLoadHazardCapsBySiteIds(prisma, context.hazardMeta, [normalized.id]);
  return {
    site: { ...normalized, hazards: hazardMap.get(normalized.id) ?? (normalized.hazards ?? {}) },
    found: true,
  };
}

export async function fallbackFindSheltersByIds(prisma: PrismaClient, ids: string[]): Promise<EvacSiteNormalized[]> {
  const context = await getFallbackContext(prisma);
  const rows = await rawFindByIds(prisma, context.meta, ids);
  const normalized = rows
    .map((row) => normalizeEvacSiteRow(row, context.meta, context.factors))
    .filter((v): v is EvacSiteNormalized => Boolean(v));

  return applyHazardCaps(prisma, context.hazardMeta, normalized);
}

export async function fallbackSearchShelters(
  prisma: PrismaClient,
  args: {
    prefCode?: string | null;
    prefName?: string | null;
    muniName?: string | null;
    muniCode?: string | null;
    q?: string | null;
    limit: number;
    offset: number;
  }
): Promise<EvacSiteNormalized[]> {
  const context = await getFallbackContext(prisma);
  const rows = await rawSearchEvacSites(prisma, context.meta, args);
  const normalized = rows
    .map((row) => normalizeEvacSiteRow(row, context.meta, context.factors))
    .filter((v): v is EvacSiteNormalized => Boolean(v));

  return applyHazardCaps(prisma, context.hazardMeta, normalized);
}

export async function fallbackNearbyShelters(
  prisma: PrismaClient,
  args: {
    lat: number;
    lon: number;
    hazardTypes?: string[] | null;
    limit: number;
    radiusKm: number;
    hideIneligible?: boolean;
    includeDiagnostics?: boolean;
  }
): Promise<{ sites: NearbyFallbackSite[]; diagnostics: NearbyFallbackDiagnostics | null }> {
  const context = await getFallbackContext(prisma);
  const hazardFilters = args.hazardTypes ?? [];
  const requestedRadiusKm = Math.max(0.1, args.radiusKm);
  const requestedLimit = Math.max(1, args.limit);
  const bufferTake = Math.max(200, requestedLimit * 20);

  const factorCandidates = mergeScaleCandidates(context.factors);

  const table = raw(context.meta.tableRef);
  const latColRaw = raw(qIdent(context.meta.latCol));
  const lonColRaw = raw(qIdent(context.meta.lonCol));
  const activeColRaw = context.meta.isActiveCol ? raw(qIdent(context.meta.isActiveCol)) : null;
  const activeClause = activeColRaw ? Prisma.sql`AND ${activeColRaw} = true` : Prisma.sql``;

  const scaleClauses = buildScaleClauses({
    latCol: latColRaw,
    lonCol: lonColRaw,
    lat: args.lat,
    lon: args.lon,
    radiusKm: requestedRadiusKm,
    factors: factorCandidates,
  });
  const bboxOr = Prisma.join(scaleClauses.map((c) => Prisma.sql`(${c.bbox})`), ' OR ');
  const distanceCase = Prisma.sql`CASE ${Prisma.join(
    scaleClauses.map((c) => Prisma.sql`WHEN ${c.bbox} THEN ${c.distanceExpr}`),
    ' '
  )} ELSE NULL END`;

  const rows = (await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM (
        SELECT *, ${distanceCase} AS distance_km
        FROM ${table}
        WHERE (${bboxOr})
          ${activeClause}
      ) t
      WHERE t.distance_km <= ${requestedRadiusKm}
      ORDER BY t.distance_km ASC
      LIMIT ${bufferTake}
    `
  )) as Array<Record<string, unknown>>;

  const normalized = rows
    .map((row) => {
      const site = normalizeEvacSiteRow(row, context.meta, factorCandidates);
      if (!site) return null;
      const distanceKm = toFiniteNumber((row as any).distance_km) ?? haversineDistance(args.lat, args.lon, site.lat, site.lon);
      return {
        ...site,
        distanceKm,
        distance: distanceKm,
      };
    })
    .filter((v): v is EvacSiteNormalized & { distanceKm: number; distance: number } => Boolean(v));

  const diagnostics = args.includeDiagnostics ? buildDiagnostics(normalized) : null;

  const hazardMap = await rawLoadHazardCapsBySiteIds(
    prisma,
    context.hazardMeta,
    normalized.map((s) => s.id)
  );

  const enriched = normalized
    .map((site) => {
      const hazards = hazardMap.get(site.id) ?? (site.hazards ?? {});
      const matches = hazardFilters.length === 0 ? true : hazardFilters.every((key) => Boolean((hazards as any)?.[key]));
      const missing = hazardFilters.filter((key) => !Boolean((hazards as any)?.[key]));
      return {
        ...site,
        hazards,
        matchesHazards: matches,
        missingHazards: missing,
      };
    })
    .filter((site) => typeof site.distanceKm === 'number' && Number.isFinite(site.distanceKm) && site.distanceKm <= requestedRadiusKm)
    .filter((site) => (args.hideIneligible ? Boolean(site.matchesHazards) : true))
    .sort((a, b) => a.distanceKm - b.distanceKm || String(a.id).localeCompare(String(b.id)))
    .slice(0, requestedLimit);

  return { sites: enriched, diagnostics };
}

export async function fallbackShelterHealth(
  prisma: PrismaClient,
  args: { lat: number; lon: number; radiusKm: number }
): Promise<ShelterHealthFallback> {
  const context = await getFallbackContext(prisma);
  const sheltersCount = await rawCountEvacSites(prisma, context.meta);
  const hazardCapsCount = context.hazardMeta ? await rawCountEvacSiteHazardCaps(prisma, context.hazardMeta) : 0;
  const nearbySampleCount = await rawCountNearbyEvacSites(prisma, context.meta, {
    lat: args.lat,
    lon: args.lon,
    radiusKm: args.radiusKm,
    factor: context.factor,
  });
  const sampleShelter = await rawSampleShelter(prisma, context.meta);

  return {
    context,
    sheltersCount,
    hazardCapsCount,
    nearbySampleCount,
    sampleShelter,
  };
}
