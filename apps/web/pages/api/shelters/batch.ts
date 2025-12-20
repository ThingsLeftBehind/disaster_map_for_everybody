import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@jp-evac/db';
import { fallbackFindSheltersByIds } from 'lib/db/sheltersFallback';
import { getEvacSitesCoordScale, normalizeLatLon } from 'lib/shelters/coords';
import {
  isEvacSitesTableMismatchError,
  safeErrorMessage,
} from 'lib/shelters/evacsiteCompat';

function nowIso() {
  return new Date().toISOString();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const raw = (Array.isArray(req.query.ids) ? req.query.ids[0] : req.query.ids) as string | undefined;
  const ids = (raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v && v.length < 200)
    .slice(0, 5);

  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return res.status(400).json({ error: 'ids is required' });

  try {
    const factor = await getEvacSitesCoordScale(prisma);
    const rows = await prisma.evac_sites.findMany({
      where: { id: { in: uniqueIds } },
      select: {
        id: true,
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

    const normalized = rows
      .map((r) => {
        const coords = normalizeLatLon({ lat: r.lat, lon: r.lon, factor });
        return coords ? { ...r, lat: coords.lat, lon: coords.lon } : null;
      })
      .filter((v): v is NonNullable<typeof v> => Boolean(v));

    const byId = new Map(normalized.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

    return res.status(200).json({ fetchStatus: 'OK', updatedAt: nowIso(), lastError: null, sites: ordered, items: ordered });
  } catch (error) {
    if (!isEvacSitesTableMismatchError(error)) {
      const message = safeErrorMessage(error);
      return res.status(200).json({ fetchStatus: 'DOWN', updatedAt: null, lastError: message, sites: [], items: [] });
    }

    try {
      const withHazards = await fallbackFindSheltersByIds(prisma, uniqueIds);

      const byId = new Map(withHazards.map((r) => [r.id, r]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
      return res.status(200).json({ fetchStatus: 'OK', updatedAt: nowIso(), lastError: null, sites: ordered, items: ordered });
    } catch (fallbackError) {
      const message = safeErrorMessage(fallbackError);
      return res.status(200).json({ fetchStatus: 'DOWN', updatedAt: null, lastError: message, sites: [], items: [] });
    }
  }
}
