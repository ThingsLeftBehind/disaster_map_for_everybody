import type { NextApiRequest, NextApiResponse } from 'next';
import { assertSameOrigin, jsonError, jsonOk, rateLimit } from 'lib/server/security';

const GEOCODE_RATE_LIMIT = { keyPrefix: 'read:geocode-address', limit: 40, windowMs: 60_000 };
const GSI_ADDRESS_SEARCH_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch';
const MAX_CANDIDATES = 8;
const TIMEOUT_MS = 4500;

type GeocodeCandidate = {
  title: string;
  address: string;
  lat: number;
  lon: number;
  source: 'gsi';
};

function first(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function sanitizeQuery(value: string | null): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function isValidCoordinate(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

async function fetchGsiCandidates(query: string): Promise<GeocodeCandidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = new URL(GSI_ADDRESS_SEARCH_URL);
    url.searchParams.set('q', query);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`gsi_http_${res.status}`);
    const json = await res.json();
    const features = Array.isArray(json) ? json : Array.isArray(json?.features) ? json.features : [];
    const candidates: GeocodeCandidate[] = [];
    const seen = new Set<string>();

    for (const feature of features) {
      const coordinates = feature?.geometry?.coordinates;
      const lon = Number(Array.isArray(coordinates) ? coordinates[0] : NaN);
      const lat = Number(Array.isArray(coordinates) ? coordinates[1] : NaN);
      if (!isValidCoordinate(lat, lon)) continue;

      const title = String(feature?.properties?.title ?? feature?.properties?.address ?? query)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      if (!title) continue;
      const key = `${title}:${lat.toFixed(6)}:${lon.toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        title,
        address: title,
        lat,
        lon,
        source: 'gsi',
      });
      if (candidates.length >= MAX_CANDIDATES) break;
    }

    return candidates;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'method_not_allowed' });
  }
  if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'forbidden' });

  const rl = rateLimit(req, GEOCODE_RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'rate_limited' });
  }

  const query = sanitizeQuery(first(req.query.q));
  if (!query || query.length < 2) {
    return jsonError(res, 400, { ok: false, error: 'invalid_query', errorCode: 'invalid_query' });
  }

  try {
    const candidates = await fetchGsiCandidates(query);
    return jsonOk(res, { ok: true, candidates });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[geocode:address] search_failed', { error: message });
    return jsonError(res, 502, { ok: false, error: 'geocode_unavailable', errorCode: 'geocode_unavailable' });
  }
}
