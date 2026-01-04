import type { Shelter } from '@/src/api/types';

export type HazardCapabilityKey =
  | 'flood'
  | 'landslide'
  | 'storm_surge'
  | 'earthquake'
  | 'tsunami'
  | 'large_fire'
  | 'inland_flood'
  | 'volcano';

export const HAZARD_CAPABILITY_UI: { key: HazardCapabilityKey; label: string }[] = [
  { key: 'flood', label: '洪水' },
  { key: 'landslide', label: '土砂災害' },
  { key: 'storm_surge', label: '高潮' },
  { key: 'earthquake', label: '地震' },
  { key: 'tsunami', label: '津波' },
  { key: 'large_fire', label: '大規模火災' },
  { key: 'inland_flood', label: '内水氾濫' },
  { key: 'volcano', label: '火山' },
];

const NORMALIZED_MAP: Record<string, HazardCapabilityKey> = {
  flood: 'flood',
  洪水: 'flood',
  landslide: 'landslide',
  土砂災害: 'landslide',
  土砂: 'landslide',
  stormsurge: 'storm_surge',
  storm_surge: 'storm_surge',
  高潮: 'storm_surge',
  earthquake: 'earthquake',
  地震: 'earthquake',
  tsunami: 'tsunami',
  津波: 'tsunami',
  largefire: 'large_fire',
  large_fire: 'large_fire',
  大規模火災: 'large_fire',
  火災: 'large_fire',
  inlandflood: 'inland_flood',
  inland_flood: 'inland_flood',
  内水氾濫: 'inland_flood',
  内水: 'inland_flood',
  volcano: 'volcano',
  火山: 'volcano',
  噴火: 'volcano',
};

export function mapHazardTypeToKey(hazardType: string): HazardCapabilityKey | null {
  if (!hazardType) return null;
  const trimmed = hazardType.trim();
  if (!trimmed) return null;
  const normalized = trimmed
    .replace(/\s+/g, '')
    .replace(/[_-]/g, '')
    .toLowerCase();
  return NORMALIZED_MAP[normalized] ?? NORMALIZED_MAP[trimmed] ?? null;
}

export function capabilityKeysFromShelter(shelter: Shelter | null | undefined): HazardCapabilityKey[] {
  if (!shelter) return [];
  const keys = new Set<HazardCapabilityKey>();
  const typed = shelter as any;

  const addKey = (raw: unknown) => {
    if (typeof raw !== 'string') return;
    const mapped = mapHazardTypeToKey(raw);
    if (mapped) keys.add(mapped);
  };

  if (Array.isArray(typed.evacSiteHazardCapabilities)) {
    typed.evacSiteHazardCapabilities.forEach((entry: any) => {
      if (typeof entry === 'string') {
        addKey(entry);
        return;
      }
      if (entry && typeof entry === 'object') {
        addKey(entry.hazardType ?? entry.hazard_type ?? entry.type ?? entry.key);
      }
    });
  }

  if (Array.isArray(typed.hazardTypes)) {
    typed.hazardTypes.forEach((entry: any) => addKey(entry));
  }

  if (typed.hazards && typeof typed.hazards === 'object') {
    Object.entries(typed.hazards as Record<string, boolean>).forEach(([key, value]) => {
      if (!value) return;
      addKey(key);
    });
  }

  return HAZARD_CAPABILITY_UI.filter((item) => keys.has(item.key)).map((item) => item.key);
}

export function capabilityChipsFromShelter(shelter: Shelter | null | undefined): Array<{
  key: HazardCapabilityKey;
  label: string;
  supported: boolean;
}> {
  const active = new Set(capabilityKeysFromShelter(shelter));
  return HAZARD_CAPABILITY_UI.map((item) => ({
    key: item.key,
    label: item.label,
    supported: active.has(item.key),
  }));
}

export function matchesAllCapabilities(
  shelter: Shelter | null | undefined,
  required: HazardCapabilityKey[]
): boolean {
  if (!required || required.length === 0) return true;
  const active = new Set(capabilityKeysFromShelter(shelter));
  return required.every((key) => active.has(key));
}
