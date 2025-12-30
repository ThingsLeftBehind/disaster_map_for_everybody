import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'node:crypto';
import { parseAtomFeed } from 'lib/jma/atom';
import { readTextFile } from 'lib/jma/cache';
import { jmaFeedXmlPath } from 'lib/jma/paths';
import { getWarningLevel, isActiveWarningItem } from 'lib/jma/filters';

type Item = { id: string; title: string; updated: string | null };

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const feeds = ['regular', 'extra'] as const;
    const items: Item[] = [];
    let updatedAt: string | null = null;

    for (const feed of feeds) {
      const xml = await readTextFile(jmaFeedXmlPath(feed));
      if (!xml) continue;

      const parsed = parseAtomFeed(xml);
      updatedAt = maxIso(updatedAt, parsed.updated);

      for (const entry of parsed.entries) {
        const title = String(entry.title ?? '').trim();
        if (!title) continue;
        if (!isActiveWarningItem({ kind: title })) continue;
        const level = getWarningLevel(title, null);
        if (level !== 'warning' && level !== 'special') continue;
        const t = entry.updated ?? entry.published ?? null;
        const id = crypto.createHash('sha256').update(`${feed}|${entry.id}|${title}`).digest('hex').slice(0, 16);
        items.push({ id, title, updated: t });
      }
    }

    const seen = new Set<string>();
    const deduped = items.filter((it) => {
      const key = it.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    deduped.sort((a, b) => {
      const ta = a.updated ? Date.parse(a.updated) : Number.NEGATIVE_INFINITY;
      const tb = b.updated ? Date.parse(b.updated) : Number.NEGATIVE_INFINITY;
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    });

    const fetchStatus = updatedAt ? 'OK' : 'DEGRADED';
    const lastError = updatedAt ? null : 'feed cache not available yet';

    return res.status(200).json({ fetchStatus, updatedAt, lastError, items: deduped.slice(0, 20) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(200).json({ fetchStatus: 'DEGRADED', updatedAt: null, lastError: message, items: [] });
  }
}
