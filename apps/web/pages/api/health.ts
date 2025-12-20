import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma, prisma } from '@jp-evac/db';
import { fallbackShelterHealth } from 'lib/db/sheltersFallback';
import { getEvacSitesCoordScale } from 'lib/shelters/coords';
import {
  getEvacSiteHazardMeta,
  isEvacSitesTableMismatchError,
  rawCountEvacSiteHazardCaps,
  rawCountNearbyEvacSites,
  rawNearestDistanceKm,
  safeErrorMessage,
} from 'lib/shelters/evacsiteCompat';

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const sample = { lat: 35.681236, lon: 139.767125 };
  const sampleRadiusKm = 5;

  const buildHaversineSql = (args: { latExpr: Prisma.Sql; lonExpr: Prisma.Sql; lat: number; lon: number }) =>
    Prisma.sql`
      (2 * 6371 * asin(sqrt(
        pow(sin((radians(${args.latExpr}) - radians(${args.lat})) / 2), 2) +
        cos(radians(${args.lat})) * cos(radians(${args.latExpr})) *
        pow(sin((radians(${args.lonExpr}) - radians(${args.lon})) / 2), 2)
      )))
    `;

  try {
    const factor = await getEvacSitesCoordScale(prisma);
    const sheltersCount = await prisma.evac_sites.count();
    const hazardMeta = await getEvacSiteHazardMeta(prisma);
    const hazardCapsCount = hazardMeta ? await rawCountEvacSiteHazardCaps(prisma, hazardMeta) : 0;

    const sampleRow = await prisma.evac_sites.findFirst({
      select: { id: true, name: true },
    });

    const latDelta = sampleRadiusKm / 111.32;
    const lonDelta = sampleRadiusKm / (111.32 * Math.max(0.2, Math.cos((sample.lat * Math.PI) / 180)));

    const latDb = sample.lat * factor;
    const lonDb = sample.lon * factor;
    const latDeltaDb = latDelta * factor;
    const lonDeltaDb = lonDelta * factor;

    const table = Prisma.raw(`"${'public'}"."${'evac_sites'}"`);
    const latColRaw = Prisma.raw(`"lat"`);
    const lonColRaw = Prisma.raw(`"lon"`);
    const latExpr = factor === 1 ? Prisma.sql`${latColRaw}::double precision` : Prisma.sql`(${latColRaw}::double precision / ${factor})`;
    const lonExpr = factor === 1 ? Prisma.sql`${lonColRaw}::double precision` : Prisma.sql`(${lonColRaw}::double precision / ${factor})`;
    const distanceExpr = buildHaversineSql({ latExpr, lonExpr, lat: sample.lat, lon: sample.lon });

    const nearbyRows = (await prisma.$queryRaw(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM (
          SELECT ${distanceExpr} AS distance_km
          FROM ${table}
          WHERE ${latColRaw} >= ${latDb - latDeltaDb} AND ${latColRaw} <= ${latDb + latDeltaDb}
            AND ${lonColRaw} >= ${lonDb - lonDeltaDb} AND ${lonColRaw} <= ${lonDb + lonDeltaDb}
        ) t
        WHERE t.distance_km <= ${sampleRadiusKm}
      `
    )) as Array<{ count: unknown }>;
    const nearbySampleCount =
      typeof nearbyRows[0]?.count === 'bigint' ? Number(nearbyRows[0].count) : Number(nearbyRows[0]?.count ?? 0);

    return res.status(200).json({
      dbConnected: true,
      sheltersCount,
      hazardCapsCount,
      sampleShelter: sampleRow ? { id: String(sampleRow.id), name: String(sampleRow.name ?? '') } : null,
      nearbySampleCount,
      lastError: null,
      fetchStatus: 'OK',
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    if (!isEvacSitesTableMismatchError(error)) {
      return res.status(200).json({
        dbConnected: false,
        sheltersCount: 0,
        hazardCapsCount: 0,
        sampleShelter: null,
        nearbySampleCount: 0,
        lastError: message,
        fetchStatus: 'DOWN',
      });
    }

    try {
      const fallback = await fallbackShelterHealth(prisma, { lat: sample.lat, lon: sample.lon, radiusKm: sampleRadiusKm });

      if (process.env.NODE_ENV === 'development') {
        const { meta, factor } = fallback.context;
        const nearest = await rawNearestDistanceKm(prisma, meta, { lat: sample.lat, lon: sample.lon, radiusKm: 30, factor });
        const within1Km = await rawCountNearbyEvacSites(prisma, meta, { lat: sample.lat, lon: sample.lon, radiusKm: 1, factor });
        const within5Km = fallback.nearbySampleCount;
        if (nearest !== null && nearest > 1.0) {
          // Local-only sanity warning; never prints coordinates or secrets.
          // eslint-disable-next-line no-console
          console.warn(`[health] Nearby sanity warning: nearestDistanceKm=${nearest.toFixed(2)} within1Km=${within1Km} within5Km=${within5Km}`);
        }
      }

      return res.status(200).json({
        dbConnected: true,
        sheltersCount: fallback.sheltersCount,
        hazardCapsCount: fallback.hazardCapsCount,
        sampleShelter: fallback.sampleShelter,
        nearbySampleCount: fallback.nearbySampleCount,
        lastError: message,
        fetchStatus: 'DEGRADED',
      });
    } catch (fallbackError) {
      return res.status(200).json({
        dbConnected: false,
        sheltersCount: 0,
        hazardCapsCount: 0,
        sampleShelter: null,
        nearbySampleCount: 0,
        lastError: safeErrorMessage(fallbackError),
        fetchStatus: 'DOWN',
      });
    }
  }
}
