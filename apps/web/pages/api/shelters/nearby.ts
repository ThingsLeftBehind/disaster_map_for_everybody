import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma } from '@prisma/client';
import { prisma, sql, type Sql } from '@jp-evac/db';
import type { Sql } from '@prisma/client/runtime/library';
import { fallbackNearbyShelters } from 'lib/db/sheltersFallback';
import { NearbyQuerySchema } from 'lib/validators';
import { haversineDistance, hazardKeys } from '@jp-evac/shared';
import { getEvacSitesCoordScales, normalizeLatLon } from 'lib/shelters/coords';
import { isEvacSitesTableMismatchError, safeErrorMessage } from 'lib/shelters/evacsiteCompat';
import { DEFAULT_MAIN_LIMIT } from 'lib/constants';

export const config = { runtime: 'nodejs' };

const BASE_SCALE_FACTORS = [1, 1e7, 1e6, 1e5, 1e4, 1e3, 1e2] as const;

function nowIso() {
  return new Date().toISOString();
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
  return sql`
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

    const bbox = sql`
      ${args.latCol} >= ${latDb - latDeltaDb} AND ${args.latCol} <= ${latDb + latDeltaDb}
      AND ${args.lonCol} >= ${lonDb - lonDeltaDb} AND ${args.lonCol} <= ${lonDb + lonDeltaDb}
    `;

    const latExpr =
      factor === 1 ? sql`${args.latCol}::double precision` : sql`(${args.latCol}::double precision / ${factor})`;
    const lonExpr =
      factor === 1 ? sql`${args.lonCol}::double precision` : sql`(${args.lonCol}::double precision / ${factor})`;
    const distanceExpr = buildHaversineSql({ latExpr, lonExpr, lat: args.lat, lon: args.lon });

    return { bbox, distanceExpr };
  });
}

function buildDiagnostics(items: Array<{ distanceKm: number }>): { minDistanceKm: number | null; countWithin1Km: number; countWithin5Km: number } {
  const distances = items.map((s) => s.distanceKm).filter((v) => Number.isFinite(v));
  const topDistances = distances.slice(0, 50);
  const minDistanceKm = topDistances.length > 0 ? Math.min(...topDistances) : null;
  const countWithin1Km = distances.filter((d) => d <= 1).length;
  const countWithin5Km = distances.filter((d) => d <= 5).length;
  return { minDistanceKm, countWithin1Km, countWithin5Km };
}

function hazardCount(hazards: Record<string, boolean> | null | undefined): number {
  if (!hazards) return 0;
  return hazardKeys.reduce((acc, key) => acc + (hazards[key] ? 1 : 0), 0);
}

function hasAnyHazard(hazards: Record<string, boolean> | null | undefined): boolean {
  return hazardCount(hazards) > 0;
}

// Dedupe key: prefer shared id, else name + address + rounded coords for stability.
function dedupeKey(site: { common_id?: string | null; name?: string | null; address?: string | null; lat?: number | null; lon?: number | null }): string {
  const commonId = site.common_id ? String(site.common_id).trim() : '';
  if (commonId) return `c:${commonId}`;
  const name = String(site.name ?? '').trim().toLowerCase();
  const address = String(site.address ?? '').trim().toLowerCase();
  const lat = typeof site.lat === 'number' && Number.isFinite(site.lat) ? site.lat.toFixed(4) : '0';
  const lon = typeof site.lon === 'number' && Number.isFinite(site.lon) ? site.lon.toFixed(4) : '0';
  return `n:${name}|a:${address}|${lat}|${lon}`;
}

function mergeHazards(a?: Record<string, boolean>, b?: Record<string, boolean>): Record<string, boolean> {
  const merged: Record<string, boolean> = {};
  for (const key of hazardKeys) {
    merged[key] = Boolean(a?.[key] || b?.[key]);
  }
  return merged;
}

function valueScore(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'string') return value.trim().length;
  if (typeof value === 'number') return Number.isFinite(value) ? 1 : 0;
  if (typeof value === 'boolean') return 1;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length;
  return 0;
}

function pickRicher<T>(a: T | null | undefined, b: T | null | undefined): T | null {
  const aScore = valueScore(a);
  const bScore = valueScore(b);
  if (aScore === 0 && bScore === 0) return (a ?? b) ?? null;
  return aScore >= bScore ? (a ?? b) ?? null : (b ?? a) ?? null;
}

function pickBase<T extends { hazards?: Record<string, boolean>; updated_at?: unknown; id?: unknown }>(a: T, b: T): T {
  const aHaz = hazardCount(a.hazards);
  const bHaz = hazardCount(b.hazards);
  if (aHaz !== bHaz) return aHaz > bHaz ? a : b;
  const aUpdated = a.updated_at ? Date.parse(String(a.updated_at)) : Number.NEGATIVE_INFINITY;
  const bUpdated = b.updated_at ? Date.parse(String(b.updated_at)) : Number.NEGATIVE_INFINITY;
  if (aUpdated !== bUpdated) return aUpdated >= bUpdated ? a : b;
  return String(a.id ?? '') <= String(b.id ?? '') ? a : b;
}

function mergeSites<T extends { hazards?: Record<string, boolean>; shelter_fields?: unknown; notes?: unknown; is_same_address_as_shelter?: boolean | null }>(a: T, b: T): T {
  const base = pickBase(a, b);
  const other = base === a ? b : a;
  return {
    ...base,
    hazards: mergeHazards(a.hazards, b.hazards),
    shelter_fields: pickRicher(base.shelter_fields, other.shelter_fields),
    notes: pickRicher(base.notes, other.notes),
    is_same_address_as_shelter: Boolean(base.is_same_address_as_shelter || other.is_same_address_as_shelter) || null,
  };
}

function dedupeSites<T extends { hazards?: Record<string, boolean>; common_id?: string | null; name?: string | null; address?: string | null; lat?: number | null; lon?: number | null; updated_at?: unknown; id?: unknown; shelter_fields?: unknown; notes?: unknown; is_same_address_as_shelter?: boolean | null }>(
  sites: T[]
): T[] {
  const map = new Map<string, T>();
  for (const site of sites) {
    const key = dedupeKey(site);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, site);
      continue;
    }
    map.set(key, mergeSites(existing, site));
  }
  return Array.from(map.values());
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const parsed = NearbyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() });
  }

  try {
    const { lat, lon, hazardTypes, limit, radiusKm, hideIneligible, q } = parsed.data;
    const hazardFilters = hazardTypes ?? [];
    const textQuery = typeof q === 'string' ? q.trim().toLowerCase() : '';
    const requestedRadiusKm = radiusKm ?? 30;
    const requestedLimit = limit ?? DEFAULT_MAIN_LIMIT;
    const overfetchLimit = Math.max(DEFAULT_MAIN_LIMIT * 4, requestedLimit * 4, 24);
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) res.setHeader('x-overfetch-limit', String(overfetchLimit));

    const scaleCandidates = await getEvacSitesCoordScales(prisma);
    const factorCandidates = mergeScaleCandidates(scaleCandidates);
    const bufferTake = overfetchLimit;

    const table = Prisma.raw(`"${'public'}"."${'evac_sites'}"`);
    const latColRaw = Prisma.raw(`"lat"`);
    const lonColRaw = Prisma.raw(`"lon"`);
    const scaleClauses = buildScaleClauses({
      latCol: latColRaw,
      lonCol: lonColRaw,
      lat,
      lon,
      radiusKm: requestedRadiusKm,
      factors: factorCandidates,
    });
    const bboxOr = Prisma.join(scaleClauses.map((c) => sql`(${c.bbox})`), ' OR ');
    const distanceCase = sql`CASE ${Prisma.join(
      scaleClauses.map((c) => sql`WHEN ${c.bbox} THEN ${c.distanceExpr}`),
      ' '
    )} ELSE NULL END`;

    const rows = (await prisma.$queryRaw(
      sql`
        SELECT *
        FROM (
          SELECT
            id,
            common_id,
            pref_city,
            name,
            address,
            lat,
            lon,
            hazards,
            is_same_address_as_shelter,
            shelter_fields,
            notes,
            source_updated_at,
            updated_at,
            ${distanceCase} AS distance_km
          FROM ${table}
          WHERE (${bboxOr})
        ) t
        WHERE t.distance_km <= ${requestedRadiusKm}
        ORDER BY t.distance_km ASC
        LIMIT ${bufferTake}
      `
    )) as Array<Record<string, unknown>>;

    const enriched = rows
      .map((site: any) => {
        const coords =
          factorCandidates.map((f) => normalizeLatLon({ lat: site.lat, lon: site.lon, factor: f })).find(Boolean) ??
          null;
        if (!coords) return null;
        const distanceKm = toFiniteNumber(site.distance_km) ?? haversineDistance(lat, lon, coords.lat, coords.lon);
        const flags = (site.hazards ?? {}) as Record<string, boolean>;
        const matches = hazardFilters.length === 0 ? true : hazardFilters.every((key) => Boolean(flags?.[key]));
        const missing = hazardFilters.filter((key) => !Boolean(flags?.[key]));
        return {
          ...site,
          hazards: flags,
          lat: coords.lat,
          lon: coords.lon,
          distanceKm,
          distance: distanceKm,
          matchesHazards: matches,
          missingHazards: missing,
        };
      })
      .filter((site): site is NonNullable<typeof site> => Boolean(site))
      .filter((site) => typeof site.distanceKm === 'number' && Number.isFinite(site.distanceKm) && site.distanceKm <= requestedRadiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm || String(a.id).localeCompare(String(b.id)));

    const devDiagnostics = isDev ? buildDiagnostics(enriched) : null;
    const deduped = dedupeSites(enriched);
    const hazardFiltered = deduped.filter((site) => hasAnyHazard(site.hazards));
    const filtered = hazardFiltered
      .filter((site) => {
        if (!textQuery) return true;
        const name = String(site.name ?? '').toLowerCase();
        const address = String(site.address ?? '').toLowerCase();
        const notes = String(site.notes ?? '').toLowerCase();
        return name.includes(textQuery) || address.includes(textQuery) || notes.includes(textQuery);
      })
      .filter((site) => (hideIneligible ? Boolean(site.matchesHazards) : true))
      .slice(0, requestedLimit);

    return res.status(200).json({
      fetchStatus: 'OK',
      updatedAt: nowIso(),
      lastError: null,
      usedFallback: false,
      usedRadiusKm: requestedRadiusKm,
      sites: filtered,
      items: filtered,
      devDiagnostics,
    });
  } catch (error) {
    if (!isEvacSitesTableMismatchError(error)) {
      const message = safeErrorMessage(error);
      return res.status(200).json({
        fetchStatus: 'DOWN',
        updatedAt: null,
        lastError: message,
        sites: [],
        items: [],
      });
    }

    try {
      const { lat, lon, hazardTypes, limit, radiusKm, hideIneligible, q } = parsed.data;
      const requestedRadiusKm = radiusKm ?? 30;
      const requestedLimit = limit ?? DEFAULT_MAIN_LIMIT;
      const overfetchLimit = Math.max(DEFAULT_MAIN_LIMIT * 4, requestedLimit * 4, 24);
      const isDev = process.env.NODE_ENV === 'development';
      if (isDev) res.setHeader('x-overfetch-limit', String(overfetchLimit));
      const fallback = await fallbackNearbyShelters(prisma, {
        lat,
        lon,
        hazardTypes,
        limit: overfetchLimit,
        radiusKm: requestedRadiusKm,
        hideIneligible,
        includeDiagnostics: isDev,
      });
      const textQuery = typeof q === 'string' ? q.trim().toLowerCase() : '';
      const dedupedFallback = dedupeSites(fallback.sites ?? []);
      const hazardFilteredFallback = dedupedFallback.filter((site) => hasAnyHazard(site.hazards));
      const fallbackSites = hazardFilteredFallback
        .filter((site) => {
          if (!textQuery) return true;
          const name = String(site.name ?? '').toLowerCase();
          const address = String(site.address ?? '').toLowerCase();
          const notes = String(site.notes ?? '').toLowerCase();
          return name.includes(textQuery) || address.includes(textQuery) || notes.includes(textQuery);
        })
        .filter((site) => (hideIneligible ? Boolean(site.matchesHazards) : true))
        .slice(0, requestedLimit);

      return res.status(200).json({
        fetchStatus: 'OK',
        updatedAt: nowIso(),
        lastError: null,
        usedFallback: true,
        usedRadiusKm: requestedRadiusKm,
        sites: fallbackSites,
        items: fallbackSites,
        devDiagnostics: fallback.diagnostics,
      });
    } catch (fallbackError) {
      const message = safeErrorMessage(fallbackError);
      return res.status(200).json({
        fetchStatus: 'DOWN',
        updatedAt: null,
        lastError: message,
        sites: [],
        items: [],
      });
    }
  }
}
