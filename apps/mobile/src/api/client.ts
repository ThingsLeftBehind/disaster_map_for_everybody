import type { ShelterVersionResponse } from './types';
import {
  clearShelterCache,
  getShelterCacheEntry,
  getShelterCacheVersion,
  setShelterCacheEntry,
  setShelterCacheVersion,
  type ShelterCacheKind,
} from '../storage/shelterCache';

const DEFAULT_API_BASE_URL = 'https://www.hinanavi.com';
const DEFAULT_TIMEOUT_MS = 10000;

export type CacheResult<T> = {
  data: T;
  fromCache: boolean;
  cachedAt: string | null;
  updatedAt: string | null;
};

type CacheConfig = {
  key: string;
  kind: ShelterCacheKind;
};

export function getApiBaseUrl() {
  const envValue = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (envValue && envValue.trim().length > 0) {
    return envValue.trim();
  }
  return DEFAULT_API_BASE_URL;
}

function buildUrl(path: string) {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const base = getApiBaseUrl().replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function buildCacheKey(path: string, params: URLSearchParams) {
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const sorted = new URLSearchParams(entries);
  return `${path}?${sorted.toString()}`;
}

export async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = init.signal ? null : new AbortController();
  const timeoutId = controller ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS) : null;

  try {
    const response = await fetch(buildUrl(path), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
      signal: init.signal ?? controller?.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const message = text ? `Request failed ${response.status}: ${text}` : `Request failed ${response.status}`;
      throw new Error(message);
    }

    return (await response.json()) as T;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function fetchJsonWithCache<T>(
  path: string,
  init: RequestInit = {},
  cache: CacheConfig
): Promise<CacheResult<T>> {
  try {
    const data = await fetchJson<T>(path, init);
    const updatedAt = extractUpdatedAt(data);
    if (shouldCacheResponse(data)) {
      await setShelterCacheEntry(cache.kind, cache.key, data, updatedAt);
    }
    return { data, fromCache: false, cachedAt: null, updatedAt };
  } catch (error) {
    const cached = await getShelterCacheEntry<T>(cache.key);
    if (cached) {
      return {
        data: cached.payload,
        fromCache: true,
        cachedAt: cached.storedAt,
        updatedAt: cached.updatedAt,
      };
    }
    throw error;
  }
}

export async function checkShelterVersion() {
  try {
    const response = await fetchJson<ShelterVersionResponse>('/api/shelters/version');
    if (response.fetchStatus !== 'OK' || !response.version) {
      return { changed: false, version: response.version ?? null, updatedAt: response.updatedAt ?? null };
    }
    const stored = await getShelterCacheVersion();
    if (stored !== response.version) {
      await clearShelterCache();
      await setShelterCacheVersion(response.version);
      return { changed: stored !== null, version: response.version, updatedAt: response.updatedAt ?? null };
    }
    return { changed: false, version: response.version, updatedAt: response.updatedAt ?? null };
  } catch {
    return { changed: false, version: null, updatedAt: null };
  }
}

function extractUpdatedAt(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const updatedAt = (value as { updatedAt?: unknown }).updatedAt;
  return typeof updatedAt === 'string' ? updatedAt : null;
}

function shouldCacheResponse(value: unknown) {
  if (!value || typeof value !== 'object') return true;
  const status = (value as { fetchStatus?: unknown }).fetchStatus;
  if (!status) return true;
  return status === 'OK';
}
