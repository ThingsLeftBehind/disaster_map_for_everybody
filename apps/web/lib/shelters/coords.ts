import { factorModeToScale, getEvacSitesSchema } from './evacSitesSchema';

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  try {
    const n = Number(value as any);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function normalizeLatLon(args: { lat: unknown; lon: unknown; factor: number }): { lat: number; lon: number } | null {
  const rawLat = toFiniteNumber(args.lat);
  const rawLon = toFiniteNumber(args.lon);
  if (rawLat === null || rawLon === null) return null;

  const factor = Number.isFinite(args.factor) && args.factor > 0 ? args.factor : 1;
  const lat = factor === 1 ? rawLat : rawLat / factor;
  const lon = factor === 1 ? rawLon : rawLon / factor;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export async function getEvacSitesCoordScale(_prisma?: unknown): Promise<number> {
  const schema = await getEvacSitesSchema();
  if (!schema.ok) throw new Error(schema.lastError);
  return factorModeToScale(schema.factorMode);
}

export async function getEvacSitesCoordScales(_prisma?: unknown): Promise<number[]> {
  const factor = await getEvacSitesCoordScale();
  return [factor];
}
