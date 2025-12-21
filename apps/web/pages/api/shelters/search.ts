import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma, prisma } from '@jp-evac/db';
import { z } from 'zod';
import { hazardKeys } from '@jp-evac/shared';
import { listMunicipalitiesByPref, listPrefectures } from 'lib/ref/municipalities';
import { fallbackNearbyShelters, fallbackSearchShelters } from 'lib/db/sheltersFallback';
import { getEvacSitesCoordScale, normalizeLatLon } from 'lib/shelters/coords';
import {
  isEvacSitesTableMismatchError,
  safeErrorMessage,
} from 'lib/shelters/evacsiteCompat';

function nowIso() {
  return new Date().toISOString();
}

type SearchMode = 'LOCATION' | 'AREA';

function normalizeText(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function textIncludes(value: unknown, needle: string): boolean {
  if (!needle) return false;
  return normalizeText(value).includes(needle);
}

function textStartsWith(value: unknown, needle: string): boolean {
  if (!needle) return false;
  return normalizeText(value).startsWith(needle);
}

function hazardCount(hazards: Record<string, boolean> | null | undefined): number {
  if (!hazards) return 0;
  return hazardKeys.reduce((acc, key) => acc + (hazards[key] ? 1 : 0), 0);
}

function hasAnyHazard(hazards: Record<string, boolean> | null | undefined): boolean {
  return hazardCount(hazards) > 0;
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

const SearchQuerySchema = z.object({
  mode: z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.enum(['LOCATION', 'AREA'])).optional(),
  lat: z
    .preprocess((v) => {
      const raw = Array.isArray(v) ? v[0] : v;
      if (raw === undefined || raw === null || raw === '') return undefined;
      return Number(raw);
    }, z.number().finite().min(-90).max(90))
    .optional(),
  lon: z
    .preprocess((v) => {
      const raw = Array.isArray(v) ? v[0] : v;
      if (raw === undefined || raw === null || raw === '') return undefined;
      return Number(raw);
    }, z.number().finite().min(-180).max(180))
    .optional(),
  prefCode: z
    .preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().regex(/^\d{2}$/))
    .optional(),
  prefName: z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().min(1)).optional(),
  muniCode: z
    .preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().regex(/^\d{6}$/))
    .optional(),
  cityText: z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().min(1)).optional(),
  q: z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().min(1).max(80)).optional(),
  hazardTypes: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) return [] as string[];
      if (Array.isArray(value)) return value;
      return value.split(',').filter(Boolean);
    })
    .transform((values) => values.filter((v) => hazardKeys.includes(v as any))),
  hideIneligible: z
    .preprocess((v) => (v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : false), z.boolean())
    .optional(),
  includeHazardless: z
    .preprocess((v) => (v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : false), z.boolean())
    .optional(),
  designatedOnly: z
    .preprocess((v) => (v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : false), z.boolean())
    .optional(),
  radiusKm: z.preprocess((v) => (v ? Number(v) : 30), z.number().min(1).max(50)).optional(),
  limit: z.preprocess((v) => (v ? Number(v) : 50), z.number().int().min(1).max(50)).optional(),
  offset: z.preprocess((v) => (v ? Number(v) : 0), z.number().int().min(0).max(10_000)).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const parsed = SearchQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() });

  const {
    mode,
    prefCode,
    prefName,
    muniCode,
    cityText,
    q,
    limit,
    offset,
    hazardTypes,
    hideIneligible,
    includeHazardless,
    designatedOnly,
    lat,
    lon,
    radiusKm,
  } = parsed.data;
  const hazardFilters = (hazardTypes ?? []).filter(Boolean);
  const debugParam = Array.isArray(req.query.debug) ? req.query.debug[0] : req.query.debug;
  const debugEnabled = process.env.NODE_ENV !== 'production' || String(debugParam ?? '') === '1';
  const debugTrace: Array<{ step: string; matchedCount: number }> = [];
  const recordTrace = (step: string, matchedCount: number) => {
    if (debugEnabled) debugTrace.push({ step, matchedCount });
  };
  const modeUsed: SearchMode = (mode ?? 'AREA') as SearchMode;

  if (mode === 'AREA' && !prefCode) {
    return res.status(400).json({ error: 'prefCode_required' });
  }
  if (modeUsed === 'LOCATION' && (lat === null || lat === undefined || lon === null || lon === undefined)) {
    return res.status(400).json({ error: 'lat_lon_required' });
  }

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
  let usedPrefFallback = false;
  if (muniCode) {
    const derivedPref = muniCode.slice(0, 2);
    const candidates = await listMunicipalitiesByPref(derivedPref);
    resolvedMuniName = candidates.find((m) => m.muniCode === muniCode)?.muniName ?? null;
  }

  const baseWhere: any[] = [];

  if (resolvedPrefName) {
    baseWhere.push({
      OR: [
        { pref_city: { startsWith: resolvedPrefName, mode: 'insensitive' } },
        { address: { startsWith: resolvedPrefName, mode: 'insensitive' } },
        { address: { contains: resolvedPrefName, mode: 'insensitive' } },
      ],
    });
  }

  const muniCodeClause = muniCode
    ? {
        OR: [
          { pref_city: { contains: muniCode, mode: 'insensitive' } },
          { address: { contains: muniCode, mode: 'insensitive' } },
          { common_id: { contains: muniCode, mode: 'insensitive' } },
        ],
      }
    : null;
  const muniNameClause = resolvedMuniName
    ? {
        OR: [
          { pref_city: { contains: resolvedMuniName, mode: 'insensitive' } },
          { address: { contains: resolvedMuniName, mode: 'insensitive' } },
        ],
      }
    : null;

  if (cityText) {
    baseWhere.push({
      OR: [
        { pref_city: { contains: cityText, mode: 'insensitive' } },
        { address: { contains: cityText, mode: 'insensitive' } },
      ],
    });
  }

  if (q) {
    baseWhere.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
      ],
    });
  }

  if (designatedOnly) {
    baseWhere.push({ shelter_fields: { not: Prisma.DbNull } });
  }

  const buildWhere = (clauses: any[]) => (clauses.length > 0 ? { AND: clauses } : {});

  const applyFilters = (sites: any[]) => {
    const enriched = sites.map((site) => {
      const flags = (site.hazards ?? {}) as Record<string, boolean>;
      const matches = hazardFilters.length === 0 ? true : hazardFilters.every((key) => Boolean(flags?.[key]));
      const missing = hazardFilters.filter((key) => !Boolean(flags?.[key]));
      return { ...site, hazards: flags, matchesHazards: matches, missingHazards: missing };
    });

    const deduped = dedupeSites(enriched);
    const designatedFiltered = designatedOnly ? deduped.filter((site) => Boolean(site.shelter_fields)) : deduped;
    const hazardFiltered = includeHazardless ? designatedFiltered : designatedFiltered.filter((site) => hasAnyHazard(site.hazards));
    return hideIneligible ? hazardFiltered.filter((site) => site.matchesHazards) : hazardFiltered;
  };

  const sortAreaSites = (sites: any[]) => {
    sites.sort((a, b) => {
      const prefA = String(a.pref_city ?? '');
      const prefB = String(b.pref_city ?? '');
      const prefCmp = prefA.localeCompare(prefB);
      if (prefCmp !== 0) return prefCmp;
      const nameA = String(a.name ?? '');
      const nameB = String(b.name ?? '');
      const nameCmp = nameA.localeCompare(nameB);
      if (nameCmp !== 0) return nameCmp;
      return String(a.id ?? '').localeCompare(String(b.id ?? ''));
    });
  };

  if (modeUsed === 'LOCATION') {
    const requestedLimit = limit ?? 50;
    const requestedRadiusKm = radiusKm ?? 30;
    const bufferLimit = Math.min(200, Math.max(requestedLimit * 5, requestedLimit));
    try {
      const fallback = await fallbackNearbyShelters(prisma, {
        lat: lat as number,
        lon: lon as number,
        hazardTypes: hazardFilters,
        limit: bufferLimit,
        radiusKm: requestedRadiusKm,
        hideIneligible,
        includeDiagnostics: debugEnabled,
      });
      recordTrace('location-raw', fallback.sites.length);

      const prefNeedle = resolvedPrefName ? resolvedPrefName.toLowerCase() : '';
      const muniCodeNeedle = muniCode ? muniCode.toLowerCase() : '';
      const muniNameNeedle = resolvedMuniName ? resolvedMuniName.toLowerCase() : '';
      const cityNeedle = cityText ? cityText.toLowerCase() : '';
      const qNeedle = q ? q.toLowerCase() : '';

      let filteredSites = applyFilters(fallback.sites ?? []);
      recordTrace('location-filtered', filteredSites.length);

      if (prefNeedle || muniCodeNeedle || muniNameNeedle || cityNeedle || qNeedle) {
        filteredSites = filteredSites.filter((site) => {
          const prefCity = normalizeText(site.pref_city);
          const address = normalizeText(site.address);
          const name = normalizeText(site.name);
          const notes = normalizeText(site.notes);
          const commonId = normalizeText(site.common_id);

          const matchesPref =
            !prefNeedle ||
            textStartsWith(prefCity, prefNeedle) ||
            textStartsWith(address, prefNeedle) ||
            textIncludes(address, prefNeedle);
          const matchesCity = !cityNeedle || textIncludes(prefCity, cityNeedle) || textIncludes(address, cityNeedle);
          let matchesMuni = true;
          if (muniCodeNeedle) {
            matchesMuni =
              textIncludes(prefCity, muniCodeNeedle) ||
              textIncludes(address, muniCodeNeedle) ||
              textIncludes(commonId, muniCodeNeedle) ||
              (muniNameNeedle && (textIncludes(prefCity, muniNameNeedle) || textIncludes(address, muniNameNeedle)));
          }
          const matchesQ =
            !qNeedle || textIncludes(name, qNeedle) || textIncludes(address, qNeedle) || textIncludes(notes, qNeedle);

          return matchesPref && matchesCity && matchesMuni && matchesQ;
        });
      }

      recordTrace('location-final', filteredSites.length);
      filteredSites.sort((a, b) => {
        const aDist = typeof a.distanceKm === 'number' ? a.distanceKm : typeof a.distance === 'number' ? a.distance : Number.POSITIVE_INFINITY;
        const bDist = typeof b.distanceKm === 'number' ? b.distanceKm : typeof b.distance === 'number' ? b.distance : Number.POSITIVE_INFINITY;
        if (aDist !== bDist) return aDist - bDist;
        return String(a.id ?? '').localeCompare(String(b.id ?? ''));
      });

      const sliced = filteredSites.slice(0, requestedLimit);
      const payload = {
        fetchStatus: 'OK',
        updatedAt: nowIso(),
        lastError: null,
        modeUsed,
        prefName: resolvedPrefName,
        muniCode: muniCode ?? null,
        muniName: resolvedMuniName,
        usedMuniFallback: false,
        usedPrefFallback: false,
        sites: sliced,
        items: sliced,
      } as any;
      if (debugEnabled) payload.debugTrace = debugTrace;
      return res.status(200).json(payload);
    } catch (error) {
      const message = safeErrorMessage(error);
      const payload = {
        fetchStatus: 'DOWN',
        updatedAt: null,
        lastError: message,
        modeUsed,
        prefName: resolvedPrefName,
        muniCode: muniCode ?? null,
        muniName: resolvedMuniName,
        usedMuniFallback: false,
        usedPrefFallback: false,
        sites: [],
        items: [],
      } as any;
      if (debugEnabled) payload.debugTrace = debugTrace;
      return res.status(200).json(payload);
    }
  }

  try {
    const factor = await getEvacSitesCoordScale(prisma);
    const fetchSites = async (whereClause: any) => {
      const rawSites = await prisma.evac_sites.findMany({
        where: whereClause,
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

      return applyFilters(sites);
    };

    const runQuery = async (whereClause: any, step: string) => {
      const results = await fetchSites(whereClause);
      recordTrace(step, results.length);
      return results;
    };

    const baseClauses = baseWhere;
    const whereMuniCode = buildWhere([...baseClauses, ...(muniCodeClause ? [muniCodeClause] : [])]);
    const whereMuniName = muniNameClause ? buildWhere([...baseClauses, muniNameClause]) : null;
    const wherePrefOnly = buildWhere(baseClauses);

    let filteredSites: any[] = [];
    if (muniCode) {
      filteredSites = await runQuery(whereMuniCode, 'muni-code');
      if (filteredSites.length === 0 && whereMuniName) {
        usedMuniFallback = true;
        filteredSites = await runQuery(whereMuniName, 'muni-name');
      }
      if (filteredSites.length === 0) {
        usedPrefFallback = true;
        filteredSites = await runQuery(wherePrefOnly, 'pref-only');
      }
    } else {
      filteredSites = await runQuery(wherePrefOnly, 'pref-only');
    }

    sortAreaSites(filteredSites);

    const payload = {
      fetchStatus: 'OK',
      updatedAt: nowIso(),
      lastError: null,
      modeUsed,
      prefName: resolvedPrefName,
      muniCode: muniCode ?? null,
      muniName: resolvedMuniName,
      usedMuniFallback,
      usedPrefFallback,
      sites: filteredSites,
      items: filteredSites,
    } as any;
    if (debugEnabled) payload.debugTrace = debugTrace;
    return res.status(200).json(payload);
  } catch (error) {
    if (!isEvacSitesTableMismatchError(error)) {
      const message = safeErrorMessage(error);
      const payload = {
        fetchStatus: 'DOWN',
        updatedAt: null,
        lastError: message,
        modeUsed,
        prefName: resolvedPrefName,
        muniCode: muniCode ?? null,
        muniName: resolvedMuniName,
        usedMuniFallback,
        usedPrefFallback: false,
        sites: [],
        items: [],
      } as any;
      if (debugEnabled) payload.debugTrace = debugTrace;
      return res.status(200).json(payload);
    }

    usedMuniFallback = false;
    usedPrefFallback = false;
    debugTrace.length = 0;

    try {
      const runFallback = async (args: { muniCode: string | null; muniName: string | null }, step: string) => {
        const results = applyFilters(
          await fallbackSearchShelters(prisma, {
            prefCode: prefCode ?? null,
            prefName: resolvedPrefName,
            muniName: args.muniName,
            muniCode: args.muniCode,
            q: q ?? cityText ?? null,
            limit: limit ?? 50,
            offset: offset ?? 0,
          })
        );
        recordTrace(step, results.length);
        return results;
      };

      let filteredSites: any[] = [];
      if (muniCode) {
        filteredSites = await runFallback({ muniCode: muniCode ?? null, muniName: null }, 'muni-code');
        if (filteredSites.length === 0 && resolvedMuniName) {
          usedMuniFallback = true;
          filteredSites = await runFallback({ muniCode: null, muniName: resolvedMuniName }, 'muni-name');
        }
        if (filteredSites.length === 0) {
          usedPrefFallback = true;
          filteredSites = await runFallback({ muniCode: null, muniName: null }, 'pref-only');
        }
      } else {
        filteredSites = await runFallback({ muniCode: null, muniName: null }, 'pref-only');
      }

      sortAreaSites(filteredSites);

      const payload = {
        fetchStatus: 'OK',
        updatedAt: nowIso(),
        lastError: null,
        modeUsed,
        prefName: resolvedPrefName,
        muniCode: muniCode ?? null,
        muniName: resolvedMuniName,
        usedMuniFallback,
        usedPrefFallback,
        sites: filteredSites,
        items: filteredSites,
      } as any;
      if (debugEnabled) payload.debugTrace = debugTrace;
      return res.status(200).json(payload);
    } catch (fallbackError) {
      const message = safeErrorMessage(fallbackError);
      const payload = {
        fetchStatus: 'DOWN',
        updatedAt: null,
        lastError: message,
        modeUsed,
        prefName: resolvedPrefName,
        muniCode: muniCode ?? null,
        muniName: resolvedMuniName,
        usedMuniFallback,
        usedPrefFallback: false,
        sites: [],
        items: [],
      } as any;
      if (debugEnabled) payload.debugTrace = debugTrace;
      return res.status(200).json(payload);
    }
  }
}
