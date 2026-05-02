import { prisma } from 'lib/db/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';
import { fallbackFindShelterById } from 'lib/db/sheltersFallback';
import { hazardKeys } from '@jp-evac/shared';
import {
  isEvacSitesTableMismatchError,
  safeErrorMessage,
} from 'lib/shelters/evacsiteCompat';
export const config = { runtime: 'nodejs' };
function nowIso() {
  return new Date().toISOString();
}

const hazardTypeToLegacyKey: Record<string, (typeof hazardKeys)[number] | null> = {
  earthquake: 'earthquake',
  tsunami: 'tsunami',
  flood: 'flood',
  inland_flood: 'inland_flood',
  landslide: 'landslide',
  volcano: 'volcano',
  storm_surge: 'storm_surge',
  fire: 'large_fire',
  typhoon: null,
};

function emptyHazards(): Record<(typeof hazardKeys)[number], boolean> {
  const out = {} as Record<(typeof hazardKeys)[number], boolean>;
  for (const key of hazardKeys) out[key] = false;
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = (Array.isArray(req.query.id) ? req.query.id[0] : req.query.id) as string | undefined;
  if (!id) return res.status(400).json({ error: 'id is required' });
  const lookup = id.trim();

  try {
    const rawSite = await prisma.evacSite.findFirst({
      where: {
        isActive: true,
        OR: [{ id: lookup }, { sourceId: lookup }],
      },
      select: {
        id: true,
        sourceId: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        municipalityCode: true,
        isDesignated: true,
        isActive: true,
        sourceName: true,
        sourceUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!rawSite) {
      return res.status(404).json({
        fetchStatus: 'OK',
        updatedAt: nowIso(),
        lastError: null,
        site: null,
      });
    }

    const hazardCaps = await prisma.evacSiteHazardCapability.findMany({
      where: { siteId: rawSite.id, isSupported: true },
      select: { hazardType: true },
    });
    const hazards = emptyHazards();
    for (const cap of hazardCaps) {
      const mapped = hazardTypeToLegacyKey[String(cap.hazardType)];
      if (mapped) hazards[mapped] = true;
    }

    const site = {
      id: String(rawSite.id),
      common_id: rawSite.sourceId ?? null,
      pref_city: rawSite.address ?? (rawSite.municipalityCode ? `自治体コード ${rawSite.municipalityCode}` : null),
      name: rawSite.name ?? '名称不明',
      address: rawSite.address ?? null,
      lat: Number.isFinite(rawSite.latitude) ? Number(rawSite.latitude) : null,
      lon: Number.isFinite(rawSite.longitude) ? Number(rawSite.longitude) : null,
      hazards,
      is_designated: rawSite.isDesignated ?? null,
      is_same_address_as_shelter: null,
      shelter_fields: rawSite.isDesignated === true ? { isDesignated: true } : null,
      notes: null,
      source_updated_at: null,
      created_at: rawSite.createdAt ?? null,
      updated_at: rawSite.updatedAt ?? null,
    };

    return res.status(200).json({ fetchStatus: 'OK', updatedAt: nowIso(), lastError: null, site });
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
