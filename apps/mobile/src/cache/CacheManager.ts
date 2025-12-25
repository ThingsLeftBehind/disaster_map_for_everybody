import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = 'shelter_cache:';
const META_KEY = 'shelter_cache_meta';
const VERSION_KEY = 'data_version';
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const TTL_DAYS = 14;
const MAX_SEARCH_HISTORY = 3;

interface CacheEntry {
    key: string;
    size: number;
    createdAt: number;
    lastAccessedAt: number;
    pinned: boolean;
    ttlDays: number;
}

interface CacheMeta {
    entries: Record<string, CacheEntry>;
    totalSize: number;
    searchHistory: string[]; // keys of recent searches
}

async function getMeta(): Promise<CacheMeta> {
    try {
        const raw = await AsyncStorage.getItem(META_KEY);
        if (raw) {
            return JSON.parse(raw);
        }
    } catch {
        // Ignore parse errors
    }
    return { entries: {}, totalSize: 0, searchHistory: [] };
}

async function saveMeta(meta: CacheMeta): Promise<void> {
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
}

function isExpired(entry: CacheEntry): boolean {
    if (entry.pinned) return false;
    const expiresAt = entry.createdAt + entry.ttlDays * 24 * 60 * 60 * 1000;
    return Date.now() > expiresAt;
}

/**
 * Evict entries using LRU until total size is under the cap.
 */
async function evictIfNeeded(meta: CacheMeta): Promise<CacheMeta> {
    // First, remove expired entries
    const expiredKeys: string[] = [];
    for (const [key, entry] of Object.entries(meta.entries)) {
        if (isExpired(entry)) {
            expiredKeys.push(key);
        }
    }

    for (const key of expiredKeys) {
        await AsyncStorage.removeItem(CACHE_PREFIX + key);
        meta.totalSize -= meta.entries[key].size;
        delete meta.entries[key];
    }

    // If still over cap, evict LRU (non-pinned first)
    while (meta.totalSize > MAX_CACHE_SIZE_BYTES) {
        const entries = Object.entries(meta.entries)
            .filter(([, e]) => !e.pinned)
            .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

        if (entries.length === 0) {
            // All entries are pinned, evict oldest pinned
            const pinnedEntries = Object.entries(meta.entries)
                .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
            if (pinnedEntries.length === 0) break;
            const [key, entry] = pinnedEntries[0];
            await AsyncStorage.removeItem(CACHE_PREFIX + key);
            meta.totalSize -= entry.size;
            delete meta.entries[key];
        } else {
            const [key, entry] = entries[0];
            await AsyncStorage.removeItem(CACHE_PREFIX + key);
            meta.totalSize -= entry.size;
            delete meta.entries[key];
        }
    }

    return meta;
}

/**
 * Store data in cache with the given key.
 */
export async function cacheSet<T>(
    key: string,
    data: T,
    options: { pinned?: boolean; isSearch?: boolean } = {}
): Promise<void> {
    const json = JSON.stringify(data);
    const size = json.length * 2; // Approximate size in bytes (UTF-16)

    let meta = await getMeta();

    // Remove old entry if exists
    if (meta.entries[key]) {
        meta.totalSize -= meta.entries[key].size;
    }

    // Add new entry
    meta.entries[key] = {
        key,
        size,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        pinned: options.pinned ?? false,
        ttlDays: TTL_DAYS,
    };
    meta.totalSize += size;

    // Track search history
    if (options.isSearch) {
        meta.searchHistory = [key, ...meta.searchHistory.filter(k => k !== key)].slice(0, MAX_SEARCH_HISTORY);
    }

    // Evict if needed
    meta = await evictIfNeeded(meta);

    // Save data and meta
    await AsyncStorage.setItem(CACHE_PREFIX + key, json);
    await saveMeta(meta);
}

/**
 * Get data from cache. Returns null if not found or expired.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
    const meta = await getMeta();
    const entry = meta.entries[key];

    if (!entry) return null;
    if (isExpired(entry)) {
        // Remove expired entry
        await AsyncStorage.removeItem(CACHE_PREFIX + key);
        delete meta.entries[key];
        meta.totalSize -= entry.size;
        await saveMeta(meta);
        return null;
    }

    // Update last accessed time
    entry.lastAccessedAt = Date.now();
    await saveMeta(meta);

    try {
        const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
        if (raw) {
            return JSON.parse(raw) as T;
        }
    } catch {
        // Ignore parse errors
    }
    return null;
}

/**
 * Pin or unpin a cache entry to prevent TTL eviction.
 */
export async function cachePin(key: string, pinned: boolean): Promise<void> {
    const meta = await getMeta();
    if (meta.entries[key]) {
        meta.entries[key].pinned = pinned;
        await saveMeta(meta);
    }
}

/**
 * Clear all caches (used when dataVersion changes).
 */
export async function cacheClearAll(): Promise<void> {
    const meta = await getMeta();
    for (const key of Object.keys(meta.entries)) {
        await AsyncStorage.removeItem(CACHE_PREFIX + key);
    }
    await saveMeta({ entries: {}, totalSize: 0, searchHistory: [] });
}

/**
 * Get cache statistics.
 */
export async function getCacheStats(): Promise<{
    totalSize: number;
    entryCount: number;
    pinnedCount: number;
}> {
    const meta = await getMeta();
    return {
        totalSize: meta.totalSize,
        entryCount: Object.keys(meta.entries).length,
        pinnedCount: Object.values(meta.entries).filter(e => e.pinned).length,
    };
}

/**
 * Generate a cache key from search parameters.
 */
export function makeCacheKey(type: 'nearby' | 'search' | 'myarea', params: Record<string, unknown>): string {
    const sorted = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${String(v)}`)
        .join('&');
    return `${type}:${sorted}`;
}
