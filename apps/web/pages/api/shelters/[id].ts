import { prisma } from 'lib/db/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';
import { fallbackFindShelterById } from 'lib/db/sheltersFallback';
import { getEvacSitesCoordScale, normalizeLatLon } from 'lib/shelters/coords';
import { hazardKeys } from '@jp-evac/shared';
import {
  getEvacSiteMeta,
  isEvacSitesTableMismatchError,
  normalizeEvacSiteRow,
  rawFindByIds,
  rawFindInBoundingBox,
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
    const evacMeta = await getEvacSiteMeta(prisma);
    const site = await prisma.evac_sites.findUnique({
      where: { id },
      select: {
        id: true,
        common_id: true,
        pref_city: true,
        name: true,
        address: true,
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
    const siteRow = (await rawFindByIds(prisma, evacMeta, [id]))[0] ?? null;
    const coords = siteRow
      ? normalizeLatLon({ lat: siteRow[evacMeta.latCol], lon: siteRow[evacMeta.lonCol], factor })
      : null;
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
        const siblingIds = siblings.map((s: any) => s.id).filter(Boolean);
        const siblingRows = siblingIds.length > 0 ? await rawFindByIds(prisma, evacMeta, siblingIds) : [];
        const siblingCoords = new Map<string, { lat: number; lon: number }>();
        for (const row of siblingRows) {
          const idRaw = row[evacMeta.idCol];
          if (idRaw === null || idRaw === undefined) continue;
          const coords = normalizeLatLon({ lat: row[evacMeta.latCol], lon: row[evacMeta.lonCol], factor });
          if (!coords) continue;
          siblingCoords.set(String(idRaw), coords);
        }
        enrichment =
          siblings
            .filter((s: any) => !hasAnyHazard(s.hazards as any) && (s.shelter_fields || s.notes))
            .map((s: any) => {
              const c = siblingCoords.get(String(s.id));
              return c ? { ...s, lat: c.lat, lon: c.lon } : s;
            })
            .sort((a: any, b: any) => hazardCount(a.hazards as any) - hazardCount(b.hazards as any))[0] ?? null;
      }

      if (!enrichment && coords) {
        const delta = 0.002;
        const latDb = factor === 1 ? coords.lat : Math.round(coords.lat * factor);
        const lonDb = factor === 1 ? coords.lon : Math.round(coords.lon * factor);
        const deltaDb = delta * factor;
        const bboxMeta = evacMeta.isActiveCol ? { ...evacMeta, isActiveCol: null } : evacMeta;
        const rows = await rawFindInBoundingBox(prisma, bboxMeta, {
          latMin: latDb - deltaDb,
          latMax: latDb + deltaDb,
          lonMin: lonDb - deltaDb,
          lonMax: lonDb + deltaDb,
          take: 5,
        });
        const siblings = rows
          .map((row) => normalizeEvacSiteRow(row, evacMeta, [factor]))
          .filter((v): v is NonNullable<typeof v> => Boolean(v))
          .filter((s) => s.id !== id)
          .filter((s) => (site.name ? s.name === site.name : true));
        enrichment =
          siblings
            .filter((s: any) => !hasAnyHazard(s.hazards as any) && (s.shelter_fields || s.notes))
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
