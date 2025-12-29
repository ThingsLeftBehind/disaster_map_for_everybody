import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Shelter } from '@/src/api/types';

export type FavoriteShelter = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  updatedAtCached: string | null;
};

export const FAVORITE_STORAGE_KEY = 'hinanavi_saved_shelters_v1';
export const FAVORITE_LIMIT = 5;

export function toFavoriteShelter(shelter: Shelter, updatedAtCached: string | null): FavoriteShelter {
  return {
    id: String(shelter.id),
    name: shelter.name ?? '避難所',
    address: shelter.address ?? null,
    lat: Number.isFinite(shelter.lat) ? shelter.lat : null,
    lon: Number.isFinite(shelter.lon) ? shelter.lon : null,
    updatedAtCached,
  };
}

export async function loadFavorites(): Promise<FavoriteShelter[]> {
  try {
    const raw = await AsyncStorage.getItem(FAVORITE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeFavorite)
      .filter((item): item is FavoriteShelter => Boolean(item));
  } catch {
    return [];
  }
}

export async function saveFavorites(items: FavoriteShelter[]): Promise<void> {
  await AsyncStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify(items));
}

function normalizeFavorite(entry: unknown): FavoriteShelter | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : record.id ? String(record.id) : null;
  if (!id) return null;
  return {
    id,
    name: typeof record.name === 'string' ? record.name : '避難所',
    address: typeof record.address === 'string' ? record.address : null,
    lat: typeof record.lat === 'number' ? record.lat : null,
    lon: typeof record.lon === 'number' ? record.lon : null,
    updatedAtCached: typeof record.updatedAtCached === 'string' ? record.updatedAtCached : null,
  };
}
