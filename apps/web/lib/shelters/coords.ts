import type { PrismaClient } from '@prisma/client';

type EvacCoordScaleCache = { factor: number; checkedAtMs: number; ranked: number[] };

let cachedScale: EvacCoordScaleCache | null = null;

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

const CANDIDATE_FACTORS = [1, 1e7, 1e6, 1e5, 1e4, 1e3, 1e2] as const;

function scoreFactor(samples: Array<{ lat: number; lon: number }>, factor: number): { japanCount: number; validCount: number } {
  let japanCount = 0;
  let validCount = 0;
  for (const s of samples) {
    const lat = factor === 1 ? s.lat : s.lat / factor;
    const lon = factor === 1 ? s.lon : s.lon / factor;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    validCount += 1;
    if (lat >= 20 && lat <= 50 && lon >= 120 && lon <= 150) japanCount += 1;
  }
  return { japanCount, validCount };
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

export async function getEvacSitesCoordScale(prisma: PrismaClient): Promise<number> {
  const ranked = await getEvacSitesCoordScales(prisma);
  return ranked[0] ?? 1;
}

export async function getEvacSitesCoordScales(prisma: PrismaClient): Promise<number[]> {
  const now = Date.now();
  if (cachedScale && now - cachedScale.checkedAtMs < 5 * 60_000) return cachedScale.ranked;

  const rawSamples = (await prisma.evac_sites.findMany({
    select: { lat: true, lon: true },
    take: 50,
  })) as Array<{ lat: unknown; lon: unknown }>;

  const samples = rawSamples
    .map((row: { lat: unknown; lon: unknown }) => {
      const lat = toFiniteNumber(row.lat);
      const lon = toFiniteNumber(row.lon);
      if (lat === null || lon === null) return null;
      return { lat, lon };
    })
    .filter((v): v is { lat: number; lon: number } => Boolean(v));

  if (samples.length === 0) {
    cachedScale = { factor: 1, checkedAtMs: now, ranked: [1] };
    return [1];
  }

  const scored = CANDIDATE_FACTORS.map((factor) => ({ factor, ...scoreFactor(samples, factor) }));
  scored.sort((a, b) => b.japanCount - a.japanCount || b.validCount - a.validCount || a.factor - b.factor);
  const ranked = scored.filter((s) => s.validCount > 0).map((s) => s.factor);
  const factor = ranked[0] ?? 1;

  cachedScale = { factor, checkedAtMs: now, ranked: ranked.length > 0 ? ranked : [factor] };
  return cachedScale.ranked;
}
