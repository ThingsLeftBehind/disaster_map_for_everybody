import { Platform } from 'react-native';
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
let didLogApiBaseUrl = false;

export type ApiError = {
  message: string;
  status: number | null;
  kind: 'http' | 'timeout' | 'network' | 'unknown';
};

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
  let resolved = '';
  if (envValue && envValue.trim().length > 0) {
    resolved = envValue.trim();
  } else if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const { hostname, port, origin } = window.location;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    const expoDevPorts = new Set(['8081', '19006', '19000', '19001']);
    if (isLocalhost && expoDevPorts.has(port)) {
      resolved = 'http://127.0.0.1:3000';
    } else if (origin) {
      resolved = origin;
    }
  }
  if (!resolved) {
    resolved = DEFAULT_API_BASE_URL;
  }
  if (__DEV__ && !didLogApiBaseUrl) {
    didLogApiBaseUrl = true;
    console.log(`[API] baseUrl=${resolved}`);
  }
  return resolved;
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
  const url = buildUrl(path);

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
      signal: init.signal ?? controller?.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const snippet = formatResponseSnippet(text);
      const message = snippet
        ? `Request failed ${response.status}: ${snippet}`
        : `Request failed ${response.status}`;
      throw createApiError(message, response.status, 'http');
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      const text = await response.text().catch(() => '');
      const snippet = formatResponseSnippet(text);
      const detail = `Expected JSON, got ${contentType || 'unknown'}. (${response.url})`;
      throw createApiError(snippet ? `${detail} ${snippet}` : detail, response.status, 'http');
    }

    return (await response.json()) as T;
  } catch (error) {
    throw toApiError(error);
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

function createApiError(message: string, status: number | null, kind: ApiError['kind']): ApiError {
  return { message, status, kind };
}

function formatResponseSnippet(text: string) {
  if (!text) return '';
  const withoutTags = text.replace(/<[^>]+>/g, ' ');
  const compact = withoutTags.replace(/\s+/g, ' ').trim();
  return compact.slice(0, 200);
}

function isApiError(value: unknown): value is ApiError {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as ApiError).message === 'string' && 'kind' in (value as ApiError);
}

export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return createApiError('Request timed out', null, 'timeout');
    }
    const message = error.message || 'Network error';
    const kind = /Failed to fetch|Network request failed/i.test(message) ? 'network' : 'unknown';
    return createApiError(message, null, kind);
  }
  return createApiError('Unknown error', null, 'unknown');
}
