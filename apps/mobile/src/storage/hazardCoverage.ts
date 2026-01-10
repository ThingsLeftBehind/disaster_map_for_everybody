import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchJson } from '@/src/api/client';
import type { Shelter, SheltersNearbyResponse } from '@/src/api/types';
import {
  HAZARD_CAPABILITY_UI,
  type HazardCapabilityKey,
  hazardKeysFromHazards,
} from '@/src/utils/hazardCapability';

export type HazardCoverageBucket = 'current' | 'myArea';

export type HazardCoverageShelter = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address: string | null;
  hazardKeys: HazardCapabilityKey[];
  updatedAt: string | null;
};

export type HazardCoverageEntry = {
  hazardKey: HazardCapabilityKey;
  shelter: HazardCoverageShelter;
  updatedAt: string | null;
};

export type HazardCoverageDebugEntry = {
  hazardKey: HazardCapabilityKey;
  found: boolean;
  radiusKm: number | null;
  shelterId: string | null;
  updatedAt: string | null;
};

export type HazardCoverageDebugSummary = {
  bucket: HazardCoverageBucket;
  generatedAt: string;
  entries: HazardCoverageDebugEntry[];
};

const STORAGE_PREFIX = 'hinanavi_hazard_coverage_v1:';
const DEBUG_PREFIX = 'hinanavi_hazard_coverage_debug_v1:';
const RADIUS_STEPS = [5, 10, 20, 30];
const MAX_LIMIT = 50;

export async function getHazardCoverage(bucket: HazardCoverageBucket): Promise<HazardCoverageEntry[]> {
  const raw = await AsyncStorage.getItem(storageKey(bucket));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as HazardCoverageEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && typeof entry.hazardKey === 'string' && entry.shelter);
  } catch {
    return [];
  }
}

export async function setHazardCoverage(bucket: HazardCoverageBucket, entries: HazardCoverageEntry[]) {
  await AsyncStorage.setItem(storageKey(bucket), JSON.stringify(entries));
}

export async function setHazardCoverageDebugSummary(bucket: HazardCoverageBucket, summary: HazardCoverageDebugSummary) {
  await AsyncStorage.setItem(debugKey(bucket), JSON.stringify(summary));
}

export async function updateHazardCoverageFromShelters(
  bucket: HazardCoverageBucket,
  shelters: Shelter[],
  updatedAt: string | null
) {
  const existing = await getHazardCoverage(bucket);
  const map = new Map<HazardCapabilityKey, HazardCoverageEntry>();
  existing.forEach((entry) => {
    map.set(entry.hazardKey, entry);
  });

  shelters.forEach((shelter) => {
    const summary = toCoverageShelter(shelter, updatedAt);
    if (!summary) return;
    summary.hazardKeys.forEach((key) => {
      if (!map.has(key)) {
        map.set(key, { hazardKey: key, shelter: summary, updatedAt: summary.updatedAt });
      }
    });
  });

  const next = HAZARD_CAPABILITY_UI.filter((item) => map.has(item.key)).map(
    (item) => map.get(item.key) as HazardCoverageEntry
  );
  await setHazardCoverage(bucket, next);
  return next;
}

export async function ensureHazardCoverage(
  bucket: HazardCoverageBucket,
  base: { lat: number; lon: number },
  shelters: Shelter[],
  updatedAt: string | null
) {
  const existing = await updateHazardCoverageFromShelters(bucket, shelters, updatedAt);
  const covered = new Set(existing.map((entry) => entry.hazardKey));
  const missing = HAZARD_CAPABILITY_UI.map((item) => item.key).filter((key) => !covered.has(key));

  if (missing.length === 0) return;

  const debugEntries: HazardCoverageDebugEntry[] = [];

  for (const hazardKey of missing) {
    const found = await fetchFirstShelterForHazard(base, hazardKey);
    if (!found) {
      debugEntries.push({ hazardKey, found: false, radiusKm: null, shelterId: null, updatedAt: null });
      continue;
    }
    const summary = toCoverageShelter(found.shelter, found.updatedAt);
    if (!summary) {
      debugEntries.push({ hazardKey, found: false, radiusKm: found.radiusKm, shelterId: null, updatedAt: found.updatedAt });
      continue;
    }
    const next = await getHazardCoverage(bucket);
    const updated = [
      ...next.filter((entry) => entry.hazardKey !== hazardKey),
      { hazardKey, shelter: summary, updatedAt: summary.updatedAt },
    ];
    await setHazardCoverage(bucket, updated);
    debugEntries.push({
      hazardKey,
      found: true,
      radiusKm: found.radiusKm,
      shelterId: summary.id,
      updatedAt: summary.updatedAt,
    });
  }

  await setHazardCoverageDebugSummary(bucket, {
    bucket,
    generatedAt: new Date().toISOString(),
    entries: debugEntries,
  });
}

function storageKey(bucket: HazardCoverageBucket) {
  return `${STORAGE_PREFIX}${bucket}`;
}

function debugKey(bucket: HazardCoverageBucket) {
  return `${DEBUG_PREFIX}${bucket}`;
}

function toCoverageShelter(shelter: Shelter, updatedAt: string | null): HazardCoverageShelter | null {
  const hazardKeys = hazardKeysFromHazards(shelter.hazards ?? null);
  if (!Number.isFinite(shelter.lat) || !Number.isFinite(shelter.lon)) return null;
  return {
    id: String(shelter.id),
    name: shelter.name ?? '避難所',
    lat: shelter.lat,
    lon: shelter.lon,
    address: shelter.address ?? null,
    hazardKeys,
    updatedAt: updatedAt ?? null,
  };
}

async function fetchFirstShelterForHazard(
  base: { lat: number; lon: number },
  hazardKey: HazardCapabilityKey
): Promise<{ shelter: Shelter; updatedAt: string | null; radiusKm: number } | null> {
  for (const radiusKm of RADIUS_STEPS) {
    const params = new URLSearchParams({
      lat: base.lat.toString(),
      lon: base.lon.toString(),
      limit: String(MAX_LIMIT),
      radiusKm: String(radiusKm),
      hideIneligible: 'false',
      hazardTypes: hazardKey,
    });
    try {
      const data = await fetchJson<SheltersNearbyResponse>(`/api/shelters/nearby?${params.toString()}`);
      const items = data.items ?? data.sites ?? [];
      const matched = items.find((item) => hazardKeysFromHazards(item.hazards ?? null).includes(hazardKey));
      if (matched) {
        return { shelter: matched, updatedAt: data.updatedAt ?? null, radiusKm };
      }
    } catch {
      continue;
    }
  }
  return null;
}
