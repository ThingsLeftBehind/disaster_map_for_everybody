import crypto from 'node:crypto';
import { NORMALIZATION_LIMITS } from './config';
import { atomicWriteFile, fileExists, readTextFile } from './cache';
import { runExclusive } from './lock';
import { parseAtomFeed } from './atom';
import { jmaEntryXmlPath, jmaFeedXmlPath } from './paths';
import { readJmaState, updateJmaState } from './state';
import type { AtomEntry, JmaFeedKey } from './types';

export function atomEntryHash(entry: AtomEntry): string {
  const basis = `${entry.id}|${entry.link ?? ''}`;
  return crypto.createHash('sha256').update(basis).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

function msSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Date.now() - t;
}

export async function refreshFeedIfStale(feed: JmaFeedKey): Promise<void> {
  const state = await readJmaState();
  const feedState = state.feeds[feed];
  const intervalMs = feedState.intervalMs;

  const stale = msSince(feedState.lastSuccessfulUpdateTime) > intervalMs;
  const recentlyAttempted = msSince(feedState.lastAttemptTime) <= intervalMs;
  if (!stale || recentlyAttempted) return;

  await runExclusive(`feed:${feed}`, async () => {
    const snapshot = await readJmaState();
    const current = snapshot.feeds[feed];
    const stillStale = msSince(current.lastSuccessfulUpdateTime) > intervalMs;
    const stillRecentlyAttempted = msSince(current.lastAttemptTime) <= intervalMs;
    if (!stillStale || stillRecentlyAttempted) return;

    await updateJmaState((draft) => {
      draft.feeds[feed].lastAttemptTime = nowIso();
    });

    const headers: Record<string, string> = {};
    if (current.etag) headers['If-None-Match'] = current.etag;
    if (current.lastModified) headers['If-Modified-Since'] = current.lastModified;

    try {
      const resp = await fetch(current.url, { headers, cache: 'no-store' });
      if (resp.status === 304) {
        await updateJmaState((draft) => {
          draft.feeds[feed].lastSuccessfulUpdateTime = nowIso();
          draft.feeds[feed].lastError = null;
        });
      } else if (resp.ok) {
        const text = await resp.text();
        await atomicWriteFile(jmaFeedXmlPath(feed), text);
        await updateJmaState((draft) => {
          draft.feeds[feed].etag = resp.headers.get('etag');
          draft.feeds[feed].lastModified = resp.headers.get('last-modified');
          draft.feeds[feed].lastSuccessfulUpdateTime = nowIso();
          draft.feeds[feed].lastError = null;
        });
      } else {
        await updateJmaState((draft) => {
          draft.feeds[feed].lastError = `HTTP ${resp.status} ${resp.statusText}`.trim();
        });
        return;
      }
    } catch (error) {
      await updateJmaState((draft) => {
        draft.feeds[feed].lastError = error instanceof Error ? error.message : String(error);
      });
      return;
    }

    const feedXml = await readTextFile(jmaFeedXmlPath(feed));
    if (!feedXml) return;
    const { entries } = parseAtomFeed(feedXml);
    const newest = entries.slice(0, NORMALIZATION_LIMITS.atomEntriesPerFeed);

    let downloads = 0;
    for (const entry of newest) {
      if (!entry.link) continue;
      const hash = atomEntryHash(entry);
      const entryPath = jmaEntryXmlPath(hash);
      if (await fileExists(entryPath)) continue;
      if (downloads >= NORMALIZATION_LIMITS.newEntryDownloadsPerRefresh) break;

      try {
        const resp = await fetch(entry.link, { cache: 'no-store' });
        if (!resp.ok) continue;
        const xml = await resp.text();
        await atomicWriteFile(entryPath, xml);
        downloads++;
      } catch {
        continue;
      }
    }
  });
}

