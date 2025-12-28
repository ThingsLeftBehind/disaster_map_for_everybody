import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma } from '@prisma/client';
import { sqltag as sql, join, raw } from '@prisma/client/runtime/library';
import { prisma } from '@jp-evac/db';
import { z } from 'zod';
import { hazardKeys } from '@jp-evac/shared';
import { listMunicipalitiesByPref, listPrefectures } from 'lib/ref/municipalities';
import { fallbackNearbyShelters, fallbackSearchShelters } from 'lib/db/sheltersFallback';
import { getEvacSitesCoordScale, normalizeLatLon } from 'lib/shelters/coords';
import {
  isEvacSitesTableMismatchError,
  safeErrorMessage,
} from 'lib/shelters/evacsiteCompat';

import { normalizeMuniCode } from 'lib/muni-helper';
export const config = { runtime: 'nodejs' };


// Force recompile: 2025-12-23T04:40
function nowIso() {
  return new Date().toISOString();
}

// Prefecture centroids for fallback location-based search
// Key: 2-digit prefCode, Value: approximate center coordinates
const PREF_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  '01': { lat: 43.06417, lon: 141.34694 }, // 北海道 (札幌)
  '02': { lat: 40.82444, lon: 140.74000 }, // 青森
  '03': { lat: 39.70361, lon: 141.15250 }, // 岩手
  '04': { lat: 38.26889, lon: 140.87194 }, // 宮城
  '05': { lat: 39.71861, lon: 140.10250 }, // 秋田
  '06': { lat: 38.24056, lon: 140.36333 }, // 山形
  '07': { lat: 37.75000, lon: 140.46778 }, // 福島
  '08': { lat: 36.34139, lon: 140.44667 }, // 茨城
  '09': { lat: 36.56583, lon: 139.88361 }, // 栃木
  '10': { lat: 36.39111, lon: 139.06083 }, // 群馬
  '11': { lat: 35.85694, lon: 139.64889 }, // 埼玉
  '12': { lat: 35.60472, lon: 140.12333 }, // 千葉
  '13': { lat: 35.68944, lon: 139.69167 }, // 東京
  '14': { lat: 35.44778, lon: 139.64250 }, // 神奈川
  '15': { lat: 37.90222, lon: 139.02361 }, // 新潟
  '16': { lat: 36.69528, lon: 137.21139 }, // 富山
  '17': { lat: 36.59444, lon: 136.62556 }, // 石川
  '18': { lat: 36.06528, lon: 136.22194 }, // 福井
  '19': { lat: 35.66389, lon: 138.56833 }, // 山梨
  '20': { lat: 36.65139, lon: 138.18111 }, // 長野
  '21': { lat: 35.39111, lon: 136.72222 }, // 岐阜
  '22': { lat: 34.97694, lon: 138.38306 }, // 静岡
  '23': { lat: 35.18028, lon: 136.90667 }, // 愛知
  '24': { lat: 34.73028, lon: 136.50861 }, // 三重
  '25': { lat: 35.00444, lon: 135.86833 }, // 滋賀
  '26': { lat: 35.02139, lon: 135.75556 }, // 京都
  '27': { lat: 34.68639, lon: 135.52000 }, // 大阪
  '28': { lat: 34.69139, lon: 135.18306 }, // 兵庫
  '29': { lat: 34.68528, lon: 135.83278 }, // 奈良
  '30': { lat: 34.22611, lon: 135.16750 }, // 和歌山
  '31': { lat: 35.50361, lon: 134.23833 }, // 鳥取
  '32': { lat: 35.47222, lon: 133.05056 }, // 島根
  '33': { lat: 34.66167, lon: 133.93500 }, // 岡山
  '34': { lat: 34.39639, lon: 132.45944 }, // 広島
  '35': { lat: 34.18583, lon: 131.47139 }, // 山口
  '36': { lat: 34.06583, lon: 134.55944 }, // 徳島
  '37': { lat: 34.34028, lon: 134.04333 }, // 香川
  '38': { lat: 33.84167, lon: 132.76611 }, // 愛媛
  '39': { lat: 33.55972, lon: 133.53111 }, // 高知
  '40': { lat: 33.60639, lon: 130.41806 }, // 福岡
  '41': { lat: 33.24944, lon: 130.29889 }, // 佐賀
  '42': { lat: 32.74472, lon: 129.87361 }, // 長崎
  '43': { lat: 32.78972, lon: 130.74167 }, // 熊本
  '44': { lat: 33.23806, lon: 131.61250 }, // 大分
  '45': { lat: 31.91111, lon: 131.42389 }, // 宮崎
  '46': { lat: 31.56028, lon: 130.55806 }, // 鹿児島
  '47': { lat: 26.21250, lon: 127.68111 }, // 沖縄
};

function getPrefectureCentroid(prefCode: string): { lat: number; lon: number } | null {
  return PREF_CENTROIDS[prefCode] ?? null;
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
  return hazardKeys.reduce((acc: any, key: any) => acc + (hazards[key] ? 1 : 0), 0);
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
    .preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().regex(/^\d{5,6}$/))
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
    .transform((values) => values.filter((v: any) => hazardKeys.includes(v as any))),
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

  // 1) Normalize muniCode: Ensure we trust 5-digit mostly
  const muniCodeRaw = parsed.data.muniCode ?? null;
  const muniCode5 = normalizeMuniCode(muniCodeRaw);
  // If raw was 6 digit, we now have 5. If raw was 5, we have 5.
  // We will primarily search by this 5-digit code.

  const hazardFilters = (hazardTypes ?? []).filter(Boolean);
  const debugParam = Array.isArray(req.query.debug) ? req.query.debug[0] : req.query.debug;
  const debugEnabled = process.env.NODE_ENV !== 'production' || String(debugParam ?? '') === '1';

  if (debugEnabled) {
    console.log('[Search] Params:', { mode, prefCode, muniCodeRaw, muniCode5, hazardTypes });
  }

  const debugTrace: Array<{ step: string; matchedCount: number }> = [];
  const recordTrace = (step: string, matchedCount: number) => {
    if (debugEnabled) {
      debugTrace.push({ step, matchedCount });
      console.log(`[Search][Trace] ${step}: ${matchedCount}`);
    }
  };

  let diagnostics: any = null;
  if (debugEnabled) {
    try {
      const total = await prisma.evac_sites.count();
      // Use type assertion for columns that may not be in Prisma types yet
      const withPrefCode = await prisma.evac_sites.count({ where: { pref_code: { not: null } } as any });
      const withMuniCode = await prisma.evac_sites.count({ where: { muni_code: { not: null } } as any });
      const withPrefCity = await prisma.evac_sites.count({ where: { pref_city: { not: null } } });
      const withAddr = await prisma.evac_sites.count({ where: { address: { not: null } } });
      const sample = await prisma.evac_sites.findFirst({
        select: { id: true, name: true, pref_city: true, address: true, common_id: true }
      }) as any;
      diagnostics = { total, withPrefCode, withMuniCode, withPrefCity, withAddr, sample };
      console.log('[Search] Diagnostics:', JSON.stringify(diagnostics, null, 2));
    } catch (e) {
      console.error('[Search] Diagnostics failed', e);
      diagnostics = { error: String(e) };
    }
  }


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
    resolvedPrefName = prefs.find((p: any) => p.prefCode === prefCode)?.prefName ?? null;
  }
  if (!resolvedPrefName && muniCode5) {
    const derivedPref = muniCode5.slice(0, 2);
    const prefs = await listPrefectures();
    resolvedPrefName = prefs.find((p: any) => p.prefCode === derivedPref)?.prefName ?? null;
  }

  let resolvedMuniName: string | null = null;
  let usedMuniFallback = false;
  let usedPrefFallback = false;

  if (muniCode5) {
    const derivedPref = muniCode5.slice(0, 2);
    const candidates = await listMunicipalitiesByPref(derivedPref);
    // candidates are typically 6-digit in our ref, but our input is 5-digit. Match prefix.
    resolvedMuniName = candidates.find((m: any) => m.muniCode === muniCode5 || m.muniCode.startsWith(muniCode5))?.muniName ?? null;
  }

  const baseWhere: any[] = [];

  if (resolvedPrefName) {
    baseWhere.push({
      OR: [
        { pref_code: prefCode }, // New column
        { pref_city: { startsWith: resolvedPrefName, mode: 'insensitive' } },
        { address: { startsWith: resolvedPrefName, mode: 'insensitive' } },
        { address: { contains: resolvedPrefName, mode: 'insensitive' } },
      ],
    });
  }

  // Build municipality code clauses - try exact code match first
  const muniCodeClauses: any[] = [];
  if (muniCode5) {
    muniCodeClauses.push({ muni_code: muniCode5 }); // Direct DB column match
  }
  const muniCodeClause = muniCodeClauses.length > 0 ? { OR: muniCodeClauses } : null;

  // Build municipality NAME clauses - this is the primary text-based fallback
  // Search by actual municipality name (e.g., "板橋区") in pref_city/address fields
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
    const enriched = sites.map((site: any) => {
      const flags = (site.hazards ?? {}) as Record<string, boolean>;
      const matches = hazardFilters.length === 0 ? true : hazardFilters.every((key: any) => Boolean(flags?.[key]));
      const missing = hazardFilters.filter((key: any) => !Boolean(flags?.[key]));
      return { ...site, hazards: flags, matchesHazards: matches, missingHazards: missing };
    });

    const deduped = dedupeSites(enriched);
    const designatedFiltered = designatedOnly ? deduped.filter((site: any) => Boolean(site.shelter_fields)) : deduped;
    const hazardFiltered = includeHazardless ? designatedFiltered : designatedFiltered.filter((site: any) => hasAnyHazard(site.hazards));
    return hideIneligible ? hazardFiltered.filter((site: any) => site.matchesHazards) : hazardFiltered;
  };

  const sortAreaSites = (sites: any[]) => {
    sites.sort((a: any, b: any) => {
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
      const muniCodeNeedle = muniCode5 ? muniCode5.toLowerCase() : '';
      const muniNameNeedle = resolvedMuniName ? resolvedMuniName.toLowerCase() : '';
      const cityNeedle = cityText ? cityText.toLowerCase() : '';
      const qNeedle = q ? q.toLowerCase() : '';

      let filteredSites = applyFilters(fallback.sites ?? []);
      recordTrace('location-filtered', filteredSites.length);

      if (prefNeedle || muniCodeNeedle || muniNameNeedle || cityNeedle || qNeedle) {
        filteredSites = filteredSites.filter((site: any) => {
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
          // Updated in-memory filtering for muni code
          if (muniCode5) {
            const code = muniCode5;
            const anyVariantMatch =
              textIncludes(prefCity, code) ||
              textIncludes(address, code) ||
              textIncludes(commonId, code);

            matchesMuni = anyVariantMatch || (Boolean(muniNameNeedle) && (textIncludes(prefCity, muniNameNeedle) || textIncludes(address, muniNameNeedle)));
          }

          const matchesQ =
            !qNeedle || textIncludes(name, qNeedle) || textIncludes(address, qNeedle) || textIncludes(notes, qNeedle);

          return matchesPref && matchesCity && matchesMuni && matchesQ;
        });
      }

      recordTrace('location-final', filteredSites.length);
      filteredSites.sort((a: any, b: any) => {
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
        muniCode: muniCode5,
        muniCodeRaw,
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
        muniCode: muniCode5,
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
          shelter_fields: true, // Required for designatedOnly filtering in applyFilters
        },
      });

      const sites = rawSites
        .map((site: any) => {
          const coords = normalizeLatLon({ lat: site.lat, lon: site.lon, factor });
          return coords ? { ...site, lat: coords.lat, lon: coords.lon } : null;
        })
        .filter((v: any): v is NonNullable<typeof v> => Boolean(v));

      if (debugEnabled) {
        console.log(`[Search] Raw Prisma returned ${rawSites.length}, after coord normalization: ${sites.length}`);
        if (rawSites.length > 0 && sites.length === 0) {
          console.log('[Search] Sample raw site:', JSON.stringify(rawSites[0], null, 2));
        }
      }

      const filtered = applyFilters(sites);
      if (debugEnabled && sites.length > 0 && filtered.length === 0) {
        console.log(`[Search] applyFilters eliminated all ${sites.length} sites`);
      }
      return filtered;
    };

    const runQuery = async (whereClause: any, step: string) => {
      if (debugEnabled) {
        console.log(`[Search][${step}] WHERE clause:`, JSON.stringify(whereClause, null, 2));
      }
      const results = await fetchSites(whereClause);
      recordTrace(step, results.length);
      if (debugEnabled) {
        console.log(`[Search][${step}] Returned ${results.length} results`);
      }
      return results;
    };

    const baseClauses = baseWhere;
    // Modified: use OR with all variants
    const whereMuniCode = buildWhere([...baseClauses, ...(muniCodeClause ? [muniCodeClause] : [])]);
    const whereMuniName = muniNameClause ? buildWhere([...baseClauses, muniNameClause]) : null;
    const wherePrefOnly = buildWhere(baseClauses);

    let filteredSites: any[] = [];
    let usedCentroidFallback = false;

    if (muniCodeRaw) {
      // Step 1: Try matching by muni_code column (most precise)
      filteredSites = await runQuery(whereMuniCode, 'db:muniCode');

      // Step 2: If no result, try matching by municipality NAME in text fields
      if (filteredSites.length === 0 && whereMuniName) {
        usedMuniFallback = true;
        filteredSites = await runQuery(whereMuniName, 'db:muniName');
      }

      // Step 3: If still no result, try prefecture-only match
      if (filteredSites.length === 0) {
        usedPrefFallback = true;
        filteredSites = await runQuery(wherePrefOnly, 'db:prefOnly');
      }

      // Step 4: If still no results from Prisma queries, try raw SQL fallback
      // This handles cases where pref_code/muni_code columns are null but address/pref_city contain the data
      if (filteredSites.length === 0) {
        recordTrace('fallback:rawSearch', 0);
        if (debugEnabled) {
          console.log(`[Search] Prisma AREA queries returned 0, trying raw SQL fallback with prefName=${resolvedPrefName}, muniName=${resolvedMuniName}`);
        }
        try {
          const rawResults = await fallbackSearchShelters(prisma, {
            prefCode: prefCode ?? null,
            prefName: resolvedPrefName,
            muniName: resolvedMuniName,
            muniCode: muniCode5,
            q: q ?? null,
            limit: limit ?? 50,
            offset: offset ?? 0,
          });
          filteredSites = applyFilters(rawResults);
          recordTrace('fallback:rawSearch-results', filteredSites.length);
          if (debugEnabled) {
            console.log(`[Search] Raw SQL fallback returned ${filteredSites.length} results`);
          }
        } catch (e) {
          if (debugEnabled) console.error('[Search] Raw SQL fallback failed:', e);
        }
      }

      // Step 5: Last resort - if AREA search failed entirely, try LOCATION fallback
      // using approximate centroid for the prefecture (hardcoded major cities)
      if (filteredSites.length === 0 && prefCode) {
        usedCentroidFallback = true;
        const centroid = getPrefectureCentroid(prefCode);
        if (centroid) {
          recordTrace('fallback:centroid-location', 0);
          if (debugEnabled) {
            console.log(`[Search] AREA returned 0, falling back to LOCATION at centroid: ${JSON.stringify(centroid)}`);
          }
          try {
            const locationFallback = await fallbackNearbyShelters(prisma, {
              lat: centroid.lat,
              lon: centroid.lon,
              hazardTypes: hazardFilters,
              limit: limit ?? 50,
              radiusKm: 30,
              hideIneligible,
              includeDiagnostics: debugEnabled,
            });
            filteredSites = applyFilters(locationFallback.sites ?? []);
            recordTrace('fallback:centroid-results', filteredSites.length);
          } catch (e) {
            if (debugEnabled) console.error('[Search] Centroid fallback failed:', e);
          }
        }
      }
    } else {
      filteredSites = await runQuery(wherePrefOnly, 'db:prefOnly');

      // Also fallback for prefix-only query if 0 results
      if (filteredSites.length === 0) {
        recordTrace('fallback:rawSearch', 0);
        if (debugEnabled) {
          console.log(`[Search] Pref-only Prisma returned 0, trying raw SQL fallback`);
        }
        try {
          const rawResults = await fallbackSearchShelters(prisma, {
            prefCode: prefCode ?? null,
            prefName: resolvedPrefName,
            muniName: null,
            muniCode: null,
            q: q ?? null,
            limit: limit ?? 50,
            offset: offset ?? 0,
          });
          filteredSites = applyFilters(rawResults);
          recordTrace('fallback:rawSearch-results', filteredSites.length);
        } catch (e) {
          if (debugEnabled) console.error('[Search] Raw SQL fallback failed:', e);
        }
      }
    }

    sortAreaSites(filteredSites);

    // Check if DB is genuinely empty
    const totalCount = diagnostics?.total ?? -1;
    const fetchStatus = totalCount === 0 ? 'EMPTY_DB' : 'OK';

    const payload = {
      fetchStatus,
      updatedAt: nowIso(),
      lastError: null,
      modeUsed: usedCentroidFallback ? 'LOCATION' : modeUsed,
      prefName: resolvedPrefName,
      muniCode: muniCode5,
      muniCodeRaw,
      muniName: resolvedMuniName,
      usedMuniFallback,
      usedPrefFallback,
      usedCentroidFallback,
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
        muniCode: muniCode5,
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
      if (muniCodeRaw) {
        // Fallback supports one code. Pass primary (prefer 5 digit).
        filteredSites = await runFallback({ muniCode: muniCode5, muniName: null }, 'muni-code');
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
        muniCode: muniCode5,
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
        muniCode: muniCode5,
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
