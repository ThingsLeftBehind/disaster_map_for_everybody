import { Prisma, prisma } from 'lib/db/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';
import { fallbackNearbyShelters } from 'lib/db/sheltersFallback';
import { NearbyQuerySchema } from 'lib/validators';
import { haversineDistance, hazardKeys } from '@jp-evac/shared';
import type { Sql } from '@prisma/client/runtime/library';
import { normalizeLatLon } from 'lib/shelters/coords';
import { factorModeToScale, getEvacSitesSchema } from 'lib/shelters/evacSitesSchema';
import { getEvacSiteHazardMeta, isEvacSitesTableMismatchError, rawLoadHazardCapsBySiteIds, safeErrorMessage } from 'lib/shelters/evacsiteCompat';
import { DEFAULT_MAIN_LIMIT } from 'lib/constants';
export const config = { runtime: 'nodejs' };

function nowIso() {
  return new Date().toISOString();
}

function qIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function buildColumnMap(columns: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const col of columns) {
    if (!col) continue;
    const key = col.toLowerCase();
    if (!map.has(key)) map.set(key, col);
  }
  return map;
}

function pickColumn(map: Map<string, string>, name: string): string | null {
  return map.get(name.toLowerCase()) ?? null;
}

function addSelectColumn(list: Sql[], map: Map<string, string>, name: string, selected?: Set<string>): string | null {
  const col = pickColumn(map, name);
  if (!col) return null;
  const key = col.toLowerCase();
  if (selected && selected.has(key)) return col;
  list.push(Prisma.raw(qIdent(col)));
  if (selected) selected.add(key);
  return col;
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

  return args.factors.map((factor: any) => {
    const latDb = factor === 1 ? args.lat : Math.round(args.lat * factor);
    const lonDb = factor === 1 ? args.lon : Math.round(args.lon * factor);
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

function buildDiagnostics(items: Array<{ distanceKm: number }>): { minDistanceKm: number | null; countWithin1Km: number; countWithin5Km: number } {
  const distances = items.map((s: any) => s.distanceKm).filter((v: any) => Number.isFinite(v));
  const topDistances = distances.slice(0, 50);
  const minDistanceKm = topDistances.length > 0 ? Math.min(...topDistances) : null;
  const countWithin1Km = distances.filter((d: any) => d <= 1).length;
  const countWithin5Km = distances.filter((d: any) => d <= 5).length;
  return { minDistanceKm, countWithin1Km, countWithin5Km };
}

function hazardCount(hazards: Record<string, boolean> | null | undefined): number {
  if (!hazards) return 0;
  return hazardKeys.reduce((acc: any, key: any) => acc + (hazards[key] ? 1 : 0), 0);
}

function hasAnyHazard(hazards: Record<string, boolean> | null | undefined): boolean {
  return hazardCount(hazards) > 0;
}

function parseHazardsValue(raw: unknown): Record<string, boolean> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, boolean>;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, boolean>;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeHazards(raw: Record<string, boolean> | null | undefined): Record<string, boolean> {
  const normalized: Record<string, boolean> = {};
  for (const key of hazardKeys) normalized[key] = Boolean(raw?.[key]);
  return normalized;
}

function buildHazards(
  row: Record<string, unknown>,
  hazardBoolCols: Partial<Record<(typeof hazardKeys)[number], string>>
): Record<string, boolean> {
  const raw = parseHazardsValue(row.hazards);
  if (raw) {
    return normalizeHazards(raw);
  }
  const hazards: Record<string, boolean> = {};
  let hasBool = false;
  for (const key of hazardKeys) {
    const col = hazardBoolCols[key];
    if (!col) continue;
    hasBool = true;
    hazards[key] = Boolean((row as any)[col]);
  }
  return normalizeHazards(hasBool ? hazards : null);
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

  const schemaResult = await getEvacSitesSchema();
  if (!schemaResult.ok) {
    return res.status(200).json({
      fetchStatus: 'DOWN',
      updatedAt: null,
      lastError: schemaResult.lastError,
      sites: [],
      items: [],
    });
  }

  try {
    const { lat, lon, hazardTypes, limit, radiusKm, hideIneligible: hideIneligibleParam, q } = parsed.data;
    const hideIneligible = hideIneligibleParam ?? false;
    const hazardFilters = hazardTypes ?? [];
    const textQuery = typeof q === 'string' ? q.trim().toLowerCase() : '';
    const requestedRadiusKm = radiusKm ?? 30;
    const requestedLimit = limit ?? DEFAULT_MAIN_LIMIT;
    const overfetchLimit = Math.max(DEFAULT_MAIN_LIMIT * 4, requestedLimit * 4, 24);
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) res.setHeader('x-overfetch-limit', String(overfetchLimit));

    const factor = factorModeToScale(schemaResult.factorMode);
    const factorCandidates = [factor];
    const bufferTake = overfetchLimit;

    const table = Prisma.raw(schemaResult.tableName);
    const latColRaw = Prisma.raw(qIdent(schemaResult.latCol));
    const lonColRaw = Prisma.raw(qIdent(schemaResult.lonCol));
    const columnMap = buildColumnMap(schemaResult.discoveredColumns);
    const selectCols: Sql[] = [];
    const selectedCols = new Set<string>();
    const idCol = pickColumn(columnMap, 'id') ?? 'id';
    selectCols.push(Prisma.raw(qIdent(idCol)));
    selectedCols.add(idCol.toLowerCase());
    addSelectColumn(selectCols, columnMap, 'common_id', selectedCols);
    addSelectColumn(selectCols, columnMap, 'pref_city', selectedCols);
    addSelectColumn(selectCols, columnMap, 'name', selectedCols);
    addSelectColumn(selectCols, columnMap, 'address', selectedCols);
    const hazardsCol = addSelectColumn(selectCols, columnMap, 'hazards', selectedCols);
    const hazardBoolCols: Partial<Record<(typeof hazardKeys)[number], string>> = {};
    for (const key of hazardKeys) {
      const col = pickColumn(columnMap, key) ?? pickColumn(columnMap, `hazard_${key}`);
      if (!col) continue;
      hazardBoolCols[key] = col;
      const colKey = col.toLowerCase();
      if (selectedCols.has(colKey)) continue;
      selectCols.push(Prisma.raw(qIdent(col)));
      selectedCols.add(colKey);
    }
    const hasHazardColumns = Boolean(hazardsCol) || Object.keys(hazardBoolCols).length > 0;
    addSelectColumn(selectCols, columnMap, 'is_same_address_as_shelter', selectedCols);
    addSelectColumn(selectCols, columnMap, 'shelter_fields', selectedCols);
    addSelectColumn(selectCols, columnMap, 'notes', selectedCols);
    addSelectColumn(selectCols, columnMap, 'source_updated_at', selectedCols);
    addSelectColumn(selectCols, columnMap, 'created_at', selectedCols);
    addSelectColumn(selectCols, columnMap, 'updated_at', selectedCols);
    selectCols.push(Prisma.sql`${latColRaw} AS lat`);
    selectCols.push(Prisma.sql`${lonColRaw} AS lon`);
    const scaleClauses = buildScaleClauses({
      latCol: latColRaw,
      lonCol: lonColRaw,
      lat,
      lon,
      radiusKm: requestedRadiusKm,
      factors: factorCandidates,
    });
    const bboxOr = Prisma.join(scaleClauses.map((c: any) => Prisma.sql`(${c.bbox})`), ' OR ');
    const distanceCase = Prisma.sql`CASE ${Prisma.join(
      scaleClauses.map((c: any) => Prisma.sql`WHEN ${c.bbox} THEN ${c.distanceExpr}`),
      ' '
    )} ELSE NULL END`;

    const rows = (await prisma.$queryRaw(
      Prisma.sql`
        SELECT ${Prisma.join(selectCols, ', ')}, ${distanceCase} AS distance_km
        FROM ${table}
        WHERE (${bboxOr})
          AND ${distanceCase} <= ${requestedRadiusKm}
        ORDER BY ${distanceCase} ASC
        LIMIT ${bufferTake}
      `
    )) as Array<Record<string, unknown>>;

    // Merge EvacSiteHazardCapability.hazardType into fixed hazard keys via evacsiteCompat normalization.
    const hazardMeta = await getEvacSiteHazardMeta(prisma);
    const hazardCapsById = await rawLoadHazardCapsBySiteIds(
      prisma,
      hazardMeta,
      rows
        .map((row) => row[idCol])
        .filter((value) => value !== null && value !== undefined)
        .map((value) => String(value))
    );

    const enriched = rows
      .map((site: any) => {
        const coords = normalizeLatLon({ lat: site.lat, lon: site.lon, factor });
        if (!coords) return null;
        const distanceKm = toFiniteNumber(site.distance_km) ?? haversineDistance(lat, lon, coords.lat, coords.lon);
        const flags = buildHazards(site, hazardBoolCols);
        const hazardCaps = hazardCapsById.get(String(site[idCol] ?? '')) ?? null;
        const hazards = mergeHazards(flags, hazardCaps ?? undefined);
        const matches = hazardFilters.length === 0 ? true : hazardFilters.every((key: any) => Boolean(hazards?.[key]));
        const missing = hazardFilters.filter((key: any) => !Boolean(hazards?.[key]));
        return {
          ...site,
          hazards,
          lat: coords.lat,
          lon: coords.lon,
          distanceKm,
          distance: distanceKm,
          matchesHazards: matches,
          missingHazards: missing,
        };
      })
      .filter((site: any): site is NonNullable<typeof site> => Boolean(site))
      .filter((site: any) => typeof site.distanceKm === 'number' && Number.isFinite(site.distanceKm) && site.distanceKm <= requestedRadiusKm)
      .sort((a: any, b: any) => a.distanceKm - b.distanceKm || String(a.id).localeCompare(String(b.id)));

    const devDiagnostics = isDev ? buildDiagnostics(enriched) : null;
    const deduped = dedupeSites(enriched);
    const hasHazardData = deduped.some((site: any) => hazardCount(site.hazards) > 0);
    const hazardFiltered = hasHazardData ? deduped.filter((site: any) => hasAnyHazard(site.hazards)) : deduped;
    const filtered = hazardFiltered
      .filter((site: any) => {
        if (!textQuery) return true;
        const name = String(site.name ?? '').toLowerCase();
        const address = String(site.address ?? '').toLowerCase();
        const notes = String(site.notes ?? '').toLowerCase();
        return name.includes(textQuery) || address.includes(textQuery) || notes.includes(textQuery);
      })
      .filter((site: any) => (hideIneligible ? Boolean(site.matchesHazards) : true))
      .slice(0, requestedLimit);

    if (isDev) {
      const latLonPresent = rows.some((row) => toFiniteNumber(row.lat) !== null && toFiniteNumber(row.lon) !== null);
      const eligibleCol =
        pickColumn(columnMap, 'eligible') ??
        pickColumn(columnMap, 'is_active') ??
        pickColumn(columnMap, 'isactive') ??
        pickColumn(columnMap, 'active') ??
        pickColumn(columnMap, 'enabled') ??
        pickColumn(columnMap, 'is_enabled');
      console.log('[nearby] response', {
        rawCount: rows.length,
        finalCount: filtered.length,
        hideIneligible,
        latLonPresent,
        eligiblePresent: Boolean(eligibleCol),
        hazardColumnsPresent: hasHazardColumns,
        hazardDataPresent: hasHazardData,
      });
      if (devDiagnostics?.countWithin5Km && devDiagnostics.countWithin5Km > 0 && filtered.length === 0) {
        console.warn('[nearby] all rows dropped after mapping/filter', {
          rawCount: rows.length,
          hideIneligible,
          hazardColumnsPresent: hasHazardColumns,
          hazardDataPresent: hasHazardData,
        });
      }
    }

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
      const { lat, lon, hazardTypes, limit, radiusKm, hideIneligible: hideIneligibleParam, q } = parsed.data;
      const hideIneligible = hideIneligibleParam ?? false;
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
      const normalizedFallback = (fallback.sites ?? []).map((site: any) => ({
        ...site,
        hazards: mergeHazards(site.hazards, undefined),
      }));
      const dedupedFallback = dedupeSites(normalizedFallback);
      const hasHazardFallback = dedupedFallback.some((site: any) => hazardCount(site.hazards) > 0);
      const hazardFilteredFallback = hasHazardFallback ? dedupedFallback.filter((site: any) => hasAnyHazard(site.hazards)) : dedupedFallback;
      const fallbackSites = hazardFilteredFallback
        .filter((site: any) => {
          if (!textQuery) return true;
          const name = String(site.name ?? '').toLowerCase();
          const address = String(site.address ?? '').toLowerCase();
          const notes = String(site.notes ?? '').toLowerCase();
          return name.includes(textQuery) || address.includes(textQuery) || notes.includes(textQuery);
        })
        .filter((site: any) => (hideIneligible ? Boolean(site.matchesHazards) : true))
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
