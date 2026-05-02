import { prisma } from 'lib/db/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';
import { fallbackFindSheltersByIds } from 'lib/db/sheltersFallback';
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

  const raw = (Array.isArray(req.query.ids) ? req.query.ids[0] : req.query.ids) as string | undefined;
  const ids = (raw ?? '')
    .split(',')
    .map((v: any) => v.trim())
    .filter((v: any) => v && v.length < 200)
    .slice(0, 5);

  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return res.status(400).json({ error: 'ids is required' });

  try {
    const rows = await prisma.evacSite.findMany({
      where: {
        isActive: true,
        OR: [{ id: { in: uniqueIds } }, { sourceId: { in: uniqueIds } }],
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
        createdAt: true,
        updatedAt: true,
      },
    });

    const siteIds = rows.map((row: any) => row.id).filter(Boolean);
    const hazardCaps =
      siteIds.length > 0
        ? await prisma.evacSiteHazardCapability.findMany({
          where: { siteId: { in: siteIds }, isSupported: true },
          select: { siteId: true, hazardType: true },
        })
        : [];
    const hazardsBySiteId = new Map<string, Record<(typeof hazardKeys)[number], boolean>>();
    for (const id of siteIds) hazardsBySiteId.set(String(id), emptyHazards());
    for (const cap of hazardCaps) {
      const sid = String(cap.siteId);
      const bag = hazardsBySiteId.get(sid) ?? emptyHazards();
      const mapped = hazardTypeToLegacyKey[String(cap.hazardType)];
      if (mapped) bag[mapped] = true;
      hazardsBySiteId.set(sid, bag);
    }

    const normalized = rows
      .map((r: any) => {
        const hazards = hazardsBySiteId.get(String(r.id)) ?? emptyHazards();
        return {
          id: String(r.id),
          common_id: r.sourceId ?? null,
          pref_city: r.address ?? (r.municipalityCode ? `自治体コード ${r.municipalityCode}` : null),
          name: r.name ?? '名称不明',
          address: r.address ?? null,
          lat: Number.isFinite(r.latitude) ? Number(r.latitude) : null,
          lon: Number.isFinite(r.longitude) ? Number(r.longitude) : null,
          hazards,
          is_designated: r.isDesignated ?? null,
          is_same_address_as_shelter: null,
          shelter_fields: r.isDesignated === true ? { isDesignated: true } : null,
          notes: null,
          source_updated_at: null,
          created_at: r.createdAt ?? null,
          updated_at: r.updatedAt ?? null,
        };
      })
      .filter((v: any): v is NonNullable<typeof v> => Boolean(v));

    const byLookup = new Map<string, any>();
    for (const row of normalized) {
      byLookup.set(String(row.id), row);
      if (row.common_id) byLookup.set(String(row.common_id), row);
    }
    const ordered: any[] = [];
    const seen = new Set<string>();
    for (const key of ids) {
      const row = byLookup.get(key);
      if (!row) continue;
      if (seen.has(String(row.id))) continue;
      seen.add(String(row.id));
      ordered.push(row);
    }

    return res.status(200).json({ fetchStatus: 'OK', updatedAt: nowIso(), lastError: null, sites: ordered, items: ordered });
  } catch (error) {
    if (!isEvacSitesTableMismatchError(error)) {
      const message = safeErrorMessage(error);
      return res.status(200).json({ fetchStatus: 'DOWN', updatedAt: null, lastError: message, sites: [], items: [] });
    }

    try {
      const withHazards = await fallbackFindSheltersByIds(prisma, uniqueIds);

      const byId = new Map(withHazards.map((r: any) => [r.id, r]));
      const ordered = ids.map((id: any) => byId.get(id)).filter(Boolean);
      return res.status(200).json({ fetchStatus: 'OK', updatedAt: nowIso(), lastError: null, sites: ordered, items: ordered });
    } catch (fallbackError) {
      const message = safeErrorMessage(fallbackError);
      return res.status(200).json({ fetchStatus: 'DOWN', updatedAt: null, lastError: message, sites: [], items: [] });
    }
  }
}
