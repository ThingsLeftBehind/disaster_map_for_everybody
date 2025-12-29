import AsyncStorage from '@react-native-async-storage/async-storage';

const INDEX_KEY = 'shelter_cache_index_v1';
const ENTRY_PREFIX = 'shelter_cache_entry_v1:';
const VERSION_KEY = 'shelter_cache_version_v1';

const MAX_TOTAL = 40;
const MAX_PER_KIND = 20;

export type ShelterCacheKind = 'nearby' | 'search';

export type ShelterCacheEntry<T> = {
  key: string;
  kind: ShelterCacheKind;
  storedAt: string;
  updatedAt: string | null;
  size: number;
  payload: T;
};

type CacheIndexEntry = {
  key: string;
  kind: ShelterCacheKind;
  storedAt: string;
  updatedAt: string | null;
  size: number;
  lastAccessedAt: string;
};

export async function getShelterCacheEntry<T>(key: string): Promise<ShelterCacheEntry<T> | null> {
  const raw = await AsyncStorage.getItem(entryKey(key));
  if (!raw) return null;
  const entry = safeParse<ShelterCacheEntry<T>>(raw);
  if (!entry) return null;
  await touchIndex(entry);
  return entry;
}

export async function setShelterCacheEntry<T>(kind: ShelterCacheKind, key: string, payload: T, updatedAt: string | null) {
  const storedAt = new Date().toISOString();
  const size = JSON.stringify(payload).length;
  const entry: ShelterCacheEntry<T> = { key, kind, storedAt, updatedAt, size, payload };
  await AsyncStorage.setItem(entryKey(key), JSON.stringify(entry));
  await updateIndex(entry);
}

export async function clearShelterCache() {
  const index = await readIndex();
  const keys = index.map((item) => entryKey(item.key));
  if (keys.length > 0) {
    await AsyncStorage.multiRemove(keys);
  }
  await AsyncStorage.removeItem(INDEX_KEY);
}

export async function getShelterCacheVersion(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(VERSION_KEY);
  return raw ?? null;
}

export async function setShelterCacheVersion(version: string | null) {
  if (!version) {
    await AsyncStorage.removeItem(VERSION_KEY);
    return;
  }
  await AsyncStorage.setItem(VERSION_KEY, version);
}

function entryKey(key: string) {
  return `${ENTRY_PREFIX}${key}`;
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readIndex(): Promise<CacheIndexEntry[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  const parsed = raw ? safeParse<CacheIndexEntry[]>(raw) : null;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item) => item && typeof item.key === 'string' && typeof item.kind === 'string');
}

async function writeIndex(index: CacheIndexEntry[]) {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

async function touchIndex(entry: ShelterCacheEntry<unknown>) {
  const index = await readIndex();
  const now = new Date().toISOString();
  const next = [
    {
      key: entry.key,
      kind: entry.kind,
      storedAt: entry.storedAt,
      updatedAt: entry.updatedAt ?? null,
      size: entry.size,
      lastAccessedAt: now,
    },
    ...index.filter((item) => item.key !== entry.key),
  ];
  await writeIndex(next);
}

async function updateIndex(entry: ShelterCacheEntry<unknown>) {
  const index = await readIndex();
  const now = new Date().toISOString();
  const next = [
    {
      key: entry.key,
      kind: entry.kind,
      storedAt: entry.storedAt,
      updatedAt: entry.updatedAt ?? null,
      size: entry.size,
      lastAccessedAt: now,
    },
    ...index.filter((item) => item.key !== entry.key),
  ];
  const { trimmed, removedKeys } = enforceLimits(next);
  if (removedKeys.length > 0) {
    await AsyncStorage.multiRemove(removedKeys.map((key) => entryKey(key)));
  }
  await writeIndex(trimmed);
}

function enforceLimits(index: CacheIndexEntry[]) {
  const removedKeys: string[] = [];
  let next = [...index];

  const countByKind = (items: CacheIndexEntry[], kind: ShelterCacheKind) => items.filter((item) => item.kind === kind);

  for (const kind of ['nearby', 'search'] as ShelterCacheKind[]) {
    let items = countByKind(next, kind);
    while (items.length > MAX_PER_KIND) {
      const toRemove = [...next].reverse().find((entry) => entry.kind === kind);
      if (!toRemove) break;
      removedKeys.push(toRemove.key);
      next = next.filter((entry) => entry.key !== toRemove.key);
      items = countByKind(next, kind);
    }
  }

  while (next.length > MAX_TOTAL) {
    const toRemove = next[next.length - 1];
    removedKeys.push(toRemove.key);
    next = next.slice(0, -1);
  }

  return { trimmed: next, removedKeys };
}
