import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma, prisma } from '@jp-evac/db';
import { fallbackNearbyShelters } from 'lib/db/sheltersFallback';
import { NearbyQuerySchema } from 'lib/validators';
import { haversineDistance } from '@jp-evac/shared';
import { getEvacSitesCoordScales, normalizeLatLon } from 'lib/shelters/coords';
import { isEvacSitesTableMismatchError, safeErrorMessage } from 'lib/shelters/evacsiteCompat';

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

function buildHaversineSql(args: { latExpr: Prisma.Sql; lonExpr: Prisma.Sql; lat: number; lon: number }): Prisma.Sql {
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

type ScaleClause = { bbox: Prisma.Sql; distanceExpr: Prisma.Sql };

function buildScaleClauses(args: {
  latCol: Prisma.Sql;
  lonCol: Prisma.Sql;
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

function buildDiagnostics(items: Array<{ distanceKm: number }>): { minDistanceKm: number | null; countWithin1Km: number; countWithin5Km: number } {
  const distances = items.map((s) => s.distanceKm).filter((v) => Number.isFinite(v));
  const topDistances = distances.slice(0, 50);
  const minDistanceKm = topDistances.length > 0 ? Math.min(...topDistances) : null;
  const countWithin1Km = distances.filter((d) => d <= 1).length;
  const countWithin5Km = distances.filter((d) => d <= 5).length;
  return { minDistanceKm, countWithin1Km, countWithin5Km };
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
    const { lat, lon, hazardTypes, limit, radiusKm, hideIneligible } = parsed.data;
    const hazardFilters = hazardTypes ?? [];
    const requestedRadiusKm = radiusKm ?? 30;
    const requestedLimit = limit ?? 20;
    const isDev = process.env.NODE_ENV === 'development';

    const scaleCandidates = await getEvacSitesCoordScales(prisma);
    const factorCandidates = mergeScaleCandidates(scaleCandidates);
    const bufferTake = Math.max(200, requestedLimit * 20);

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
    const bboxOr = Prisma.join(scaleClauses.map((c) => Prisma.sql`(${c.bbox})`), ' OR ');
    const distanceCase = Prisma.sql`CASE ${Prisma.join(
      scaleClauses.map((c) => Prisma.sql`WHEN ${c.bbox} THEN ${c.distanceExpr}`),
      ' '
    )} ELSE NULL END`;

    const rows = (await prisma.$queryRaw(
      Prisma.sql`
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

    const filtered = enriched
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
      const { lat, lon, hazardTypes, limit, radiusKm, hideIneligible } = parsed.data;
      const requestedRadiusKm = radiusKm ?? 30;
      const requestedLimit = limit ?? 20;
      const isDev = process.env.NODE_ENV === 'development';
      const fallback = await fallbackNearbyShelters(prisma, {
        lat,
        lon,
        hazardTypes,
        limit: requestedLimit,
        radiusKm: requestedRadiusKm,
        hideIneligible,
        includeDiagnostics: isDev,
      });

      return res.status(200).json({
        fetchStatus: 'OK',
        updatedAt: nowIso(),
        lastError: null,
        usedFallback: true,
        usedRadiusKm: requestedRadiusKm,
        sites: fallback.sites,
        items: fallback.sites,
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
