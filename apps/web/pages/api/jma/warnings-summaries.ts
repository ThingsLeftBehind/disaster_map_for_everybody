import type { NextApiRequest, NextApiResponse } from 'next';
import { readCachedWarnings } from 'lib/jma/normalize';
import { getJmaWarningPriority } from 'lib/jma/filters';

type Summary = {
  area: string;
  areaName: string | null;
  updatedAt: string | null;
  urgentCount: number;
  advisoryCount: number;
  topUrgent: string[];
  topAdvisory: string[];
};

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const raw = (Array.isArray(req.query.areas) ? req.query.areas[0] : req.query.areas) as string | undefined;
  const areas = (raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => /^\d{6}$/.test(v))
    .slice(0, 6);

  const uniqueAreas = Array.from(new Set(areas));
  if (uniqueAreas.length === 0) {
    return res.status(200).json({ fetchStatus: 'DEGRADED', updatedAt: null, lastError: 'areas is required', areas: [] });
  }

  const cached = await readCachedWarnings();

  let updatedAt: string | null = null;
  const summaries: Summary[] = uniqueAreas.map((area) => {
    const snap = cached.areas[area] ?? null;
    const items = snap?.items ?? [];
    updatedAt = maxIso(updatedAt, snap?.updatedAt ?? null);

    const urgentCounts = new Map<string, number>();
    const advisoryCounts = new Map<string, number>();

    for (const it of items) {
      const kind = String((it as any)?.kind ?? '').trim();
      if (!kind) continue;
      const p = getJmaWarningPriority(kind);
      if (p === 'URGENT') urgentCounts.set(kind, (urgentCounts.get(kind) ?? 0) + 1);
      if (p === 'ADVISORY') advisoryCounts.set(kind, (advisoryCounts.get(kind) ?? 0) + 1);
    }

    const topUrgent = Array.from(urgentCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([kind]) => kind)
      .slice(0, 2);
    const topAdvisory = Array.from(advisoryCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([kind]) => kind)
      .slice(0, 2);

    return {
      area,
      areaName: snap?.areaName ?? null,
      updatedAt: snap?.updatedAt ?? null,
      urgentCount: urgentCounts.size,
      advisoryCount: advisoryCounts.size,
      topUrgent,
      topAdvisory,
    };
  });

  const fetchStatus = updatedAt ? 'OK' : 'DEGRADED';
  return res.status(200).json({ fetchStatus, updatedAt, lastError: null, areas: summaries });
}

