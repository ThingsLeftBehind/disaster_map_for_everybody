import { Prisma, prisma } from 'lib/db/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';
import { fallbackFindShelterById } from 'lib/db/sheltersFallback';
import { getEvacSitesCoordScale, normalizeLatLon } from 'lib/shelters/coords';
import { hazardKeys } from '@jp-evac/shared';
import {
  isEvacSitesTableMismatchError,
  safeErrorMessage,
} from 'lib/shelters/evacsiteCompat';
export const config = { runtime: 'nodejs' };
function nowIso() {
  return new Date().toISOString();
}

function hazardCount(hazards: Record<string, boolean> | null | undefined): number {
  if (!hazards) return 0;
  return hazardKeys.reduce((acc: any, key: any) => acc + (hazards[key] ? 1 : 0), 0);
}

function hasAnyHazard(hazards: Record<string, boolean> | null | undefined): boolean {
  return hazardCount(hazards) > 0;
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

    let enrichment: typeof normalized | null = null;
    try {
      if (site.common_id) {
        const siblings = await prisma.evac_sites.findMany({
          where: { common_id: site.common_id, NOT: { id } },
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
          take: 5,
        });
        enrichment =
          siblings
            .filter((s: any) => !hasAnyHazard(s.hazards as any) && (s.shelter_fields || s.notes))
            .map((s: any) => {
              const c = normalizeLatLon({ lat: s.lat, lon: s.lon, factor });
              return c ? { ...s, lat: c.lat, lon: c.lon } : s;
            })
            .sort((a: any, b: any) => hazardCount(a.hazards as any) - hazardCount(b.hazards as any))[0] ?? null;
      }

      if (!enrichment && coords) {
        const delta = 0.002;
        const latDb = coords.lat * factor;
        const lonDb = coords.lon * factor;
        const deltaDb = delta * factor;
        const siblings = await prisma.evac_sites.findMany({
          where: {
            id: { not: id },
            name: site.name ?? undefined,
            lat: { gte: latDb - deltaDb, lte: latDb + deltaDb },
            lon: { gte: lonDb - deltaDb, lte: lonDb + deltaDb },
          },
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
          take: 5,
        });
        enrichment =
          siblings
            .filter((s: any) => !hasAnyHazard(s.hazards as any) && (s.shelter_fields || s.notes))
            .map((s: any) => {
              const c = normalizeLatLon({ lat: s.lat, lon: s.lon, factor });
              return c ? { ...s, lat: c.lat, lon: c.lon } : s;
            })
            .sort((a: any, b: any) => hazardCount(a.hazards as any) - hazardCount(b.hazards as any))[0] ?? null;
      }
    } catch {
      enrichment = null;
    }

    const merged = {
      ...normalized,
      shelter_fields: pickRicher(normalized.shelter_fields, enrichment?.shelter_fields),
      notes: pickRicher(normalized.notes, enrichment?.notes),
    };

    return res.status(200).json({ fetchStatus: 'OK', updatedAt: nowIso(), lastError: null, site: merged });
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
