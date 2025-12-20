import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@jp-evac/db';
import { z } from 'zod';
import { listMunicipalitiesByPref, listPrefectures } from 'lib/ref/municipalities';
import { fallbackSearchShelters } from 'lib/db/sheltersFallback';
import { getEvacSitesCoordScale, normalizeLatLon } from 'lib/shelters/coords';
import {
  isEvacSitesTableMismatchError,
  safeErrorMessage,
} from 'lib/shelters/evacsiteCompat';

function nowIso() {
  return new Date().toISOString();
}

const SearchQuerySchema = z.object({
  prefCode: z
    .preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().regex(/^\d{2}$/))
    .optional(),
  prefName: z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().min(1)).optional(),
  muniCode: z
    .preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().regex(/^\d{6}$/))
    .optional(),
  cityText: z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().min(1)).optional(),
  q: z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().min(1)).optional(),
  limit: z.preprocess((v) => (v ? Number(v) : 50), z.number().int().min(1).max(50)).optional(),
  offset: z.preprocess((v) => (v ? Number(v) : 0), z.number().int().min(0).max(10_000)).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const parsed = SearchQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() });

  const { prefCode, prefName, muniCode, cityText, q, limit, offset } = parsed.data;

  let resolvedPrefName: string | null = prefName ?? null;
  if (!resolvedPrefName && prefCode) {
    const prefs = await listPrefectures();
    resolvedPrefName = prefs.find((p) => p.prefCode === prefCode)?.prefName ?? null;
  }
  if (!resolvedPrefName && muniCode) {
    const derivedPref = muniCode.slice(0, 2);
    const prefs = await listPrefectures();
    resolvedPrefName = prefs.find((p) => p.prefCode === derivedPref)?.prefName ?? null;
  }

  let resolvedMuniName: string | null = null;
  let usedMuniFallback = false;
  if (muniCode) {
    const derivedPref = muniCode.slice(0, 2);
    const candidates = await listMunicipalitiesByPref(derivedPref);
    resolvedMuniName = candidates.find((m) => m.muniCode === muniCode)?.muniName ?? null;
    usedMuniFallback = Boolean(resolvedMuniName);
  }

  const andWhere: any[] = [];

  if (resolvedPrefName) {
    andWhere.push({
      OR: [
        { pref_city: { startsWith: resolvedPrefName, mode: 'insensitive' } },
        { address: { startsWith: resolvedPrefName, mode: 'insensitive' } },
        { address: { contains: resolvedPrefName, mode: 'insensitive' } },
      ],
    });
  }

  if (muniCode) {
    if (resolvedMuniName) {
      // DB does not have an explicit municipality code column; filter by best-effort text match.
      andWhere.push({
        OR: [
          { pref_city: { contains: resolvedMuniName, mode: 'insensitive' } },
          { address: { contains: resolvedMuniName, mode: 'insensitive' } },
        ],
      });
    } else {
      // Keep legacy heuristic (may be ineffective depending on DB content).
      andWhere.push({
        OR: [
          { pref_city: { contains: muniCode, mode: 'insensitive' } },
          { address: { contains: muniCode, mode: 'insensitive' } },
          { common_id: { contains: muniCode, mode: 'insensitive' } },
        ],
      });
    }
  }

  if (cityText) {
    andWhere.push({
      OR: [
        { pref_city: { contains: cityText, mode: 'insensitive' } },
        { address: { contains: cityText, mode: 'insensitive' } },
      ],
    });
  }

  if (q) {
    andWhere.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
      ],
    });
  }

  const where = andWhere.length > 0 ? { AND: andWhere } : {};

  try {
    const factor = await getEvacSitesCoordScale(prisma);
    const rawSites = await prisma.evac_sites.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      take: limit ?? 50,
      skip: offset ?? 0,
      select: {
        id: true,
        common_id: true,
        pref_city: true,
        name: true,
        address: true,
        lat: true,
        lon: true,
        hazards: true,
        is_same_address_as_shelter: true,
        notes: true,
        source_updated_at: true,
        updated_at: true,
      },
    });

    const sites = rawSites
      .map((site) => {
        const coords = normalizeLatLon({ lat: site.lat, lon: site.lon, factor });
        return coords ? { ...site, lat: coords.lat, lon: coords.lon } : null;
      })
      .filter((v): v is NonNullable<typeof v> => Boolean(v));

    return res.status(200).json({
      fetchStatus: 'OK',
      updatedAt: nowIso(),
      lastError: null,
      prefName: resolvedPrefName,
      muniCode: muniCode ?? null,
      muniName: resolvedMuniName,
      usedMuniFallback,
      sites,
      items: sites,
    });
  } catch (error) {
    if (!isEvacSitesTableMismatchError(error)) {
      const message = safeErrorMessage(error);
      return res.status(200).json({
        fetchStatus: 'DOWN',
        updatedAt: null,
        lastError: message,
        prefName: resolvedPrefName,
        muniCode: muniCode ?? null,
        muniName: resolvedMuniName,
        usedMuniFallback,
        sites: [],
        items: [],
      });
    }

    try {
      const sites = await fallbackSearchShelters(prisma, {
        prefCode: prefCode ?? null,
        prefName: resolvedPrefName,
        muniName: resolvedMuniName,
        muniCode: muniCode ?? null,
        q: q ?? cityText ?? null,
        limit: limit ?? 50,
        offset: offset ?? 0,
      });

      return res.status(200).json({
        fetchStatus: 'OK',
        updatedAt: nowIso(),
        lastError: null,
        prefName: resolvedPrefName,
        muniCode: muniCode ?? null,
        muniName: resolvedMuniName,
        usedMuniFallback,
        sites,
        items: sites,
      });
    } catch (fallbackError) {
      const message = safeErrorMessage(fallbackError);
      return res.status(200).json({
        fetchStatus: 'DOWN',
        updatedAt: null,
        lastError: message,
        prefName: resolvedPrefName,
        muniCode: muniCode ?? null,
        muniName: resolvedMuniName,
        usedMuniFallback,
        sites: [],
        items: [],
      });
    }
  }
}
