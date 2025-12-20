import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@jp-evac/db';
import { fallbackFindShelterById } from 'lib/db/sheltersFallback';
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

  const id = (Array.isArray(req.query.id) ? req.query.id[0] : req.query.id) as string | undefined;
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const factor = await getEvacSitesCoordScale(prisma);
    const site = await prisma.evac_sites.findUnique({
      where: { id },
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
        shelter_fields: true,
        notes: true,
        source_updated_at: true,
        updated_at: true,
        created_at: true,
      },
    });

    if (!site) return res.status(404).json({ error: 'Not found' });
    const coords = normalizeLatLon({ lat: site.lat, lon: site.lon, factor });
    const normalized = coords ? { ...site, lat: coords.lat, lon: coords.lon } : site;

    return res.status(200).json({ fetchStatus: 'OK', updatedAt: nowIso(), lastError: null, site: normalized });
  } catch (error) {
    if (!isEvacSitesTableMismatchError(error)) {
      const message = safeErrorMessage(error);
      return res.status(200).json({ fetchStatus: 'DOWN', updatedAt: null, lastError: message, site: null });
    }

    try {
      const result = await fallbackFindShelterById(prisma, id);
      if (!result.found) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ fetchStatus: 'OK', updatedAt: nowIso(), lastError: null, site: result.site });
    } catch (fallbackError) {
      const message = safeErrorMessage(fallbackError);
      return res.status(200).json({ fetchStatus: 'DOWN', updatedAt: null, lastError: message, site: null });
    }
  }
}
