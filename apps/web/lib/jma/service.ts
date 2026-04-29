import { LOCK_TTLS_MS, WEBJSON_INTERVALS_MS } from './config';
import { runExclusive } from './lock';
import { refreshFeedIfStale } from './fetchers';
import { refreshWebJsonQuakeListIfStale, refreshWebJsonWarningAreaIfStale } from './webjson';
import { readJmaState } from './state';
import type { FetchStatus, JmaFeedKey, NormalizedWarningItem } from './types';
import {
  rebuildNormalizedQuakes,
  rebuildNormalizedStatus,
  readCachedQuakes,
  readCachedStatus,
  readCachedWarnings,
  updateNormalizedWarningsArea,
} from './normalize';

function computeFetchStatus(updatedAt: string | null, lastError: string | null): FetchStatus {
  if (!updatedAt) return 'DEGRADED';
  if (lastError) return 'DEGRADED';
  return 'OK';
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function msSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Date.now() - t;
}

function isOlderThan(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!b) return false;
  if (!a) return true;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(tb)) return false;
  if (Number.isNaN(ta)) return true;
  return ta < tb;
}

export async function getJmaStatus(): Promise<{
  fetchStatus: FetchStatus;
  updatedAt: string | null;
  lastError: string | null;
  feeds: Record<
    JmaFeedKey,
    {
      fetchStatus: FetchStatus;
      updatedAt: string | null;
      lastError: string | null;
      stale?: boolean;
      lastAttemptAt?: string | null;
      lastHttpStatus?: number | null;
      lastItemCount?: number | null;
      lastDurationMs?: number | null;
    }
  >;
  webjson?: Record<string, unknown>;
  sources?: Array<Record<string, unknown>>;
}> {
  await triggerStaleRefresh(['regular', 'extra', 'eqvol']);
  await refreshWebJsonQuakeListIfStale();
  void triggerStaleRefresh(['other']);

  const normalized = await runExclusive('normalize:status', () => rebuildNormalizedStatus(), LOCK_TTLS_MS.normalize);
  const cached = normalized.value ?? (await readCachedStatus());
  if (cached) {
    const sourceError = cached.sources?.map((s) => s.last_error).find(Boolean) ?? null;
    return {
      fetchStatus: cached.fetchStatus,
      updatedAt: cached.updatedAt,
      lastError: cached.fetchStatus === 'OK' ? null : sourceError,
      feeds: cached.feeds,
      webjson: cached.webjson,
      sources: cached.sources,
    };
  }

  const state = await readJmaState();
  const feeds = Object.fromEntries(
    (Object.keys(state.feeds) as JmaFeedKey[]).map((feed) => {
      const s = state.feeds[feed];
      return [
        feed,
        {
          fetchStatus: computeFetchStatus(s.lastSuccessfulUpdateTime, s.lastError),
          updatedAt: s.lastSuccessfulUpdateTime,
          lastError: s.lastError,
          stale: false,
          lastAttemptAt: s.lastAttemptTime,
          lastHttpStatus: s.lastHttpStatus ?? null,
          lastItemCount: s.lastItemCount ?? null,
          lastDurationMs: s.lastDurationMs ?? null,
        },
      ];
    })
  ) as any;

  const updatedAt = (Object.keys(feeds) as JmaFeedKey[]).reduce<string | null>((acc, feed) => maxIso(acc, feeds[feed].updatedAt), null);
  const lastError = (Object.keys(feeds) as JmaFeedKey[]).map((f) => feeds[f].lastError).find(Boolean) ?? null;
  return { fetchStatus: lastError ? 'DEGRADED' : updatedAt ? 'OK' : 'DOWN', updatedAt, lastError, feeds };
}

export async function getJmaQuakes(): Promise<{
  fetchStatus: FetchStatus;
  updatedAt: string | null;
  lastError: string | null;
  items: Array<{
    id: string;
    time: string | null;
    title: string;
    link: string | null;
    maxIntensity: string | null;
    magnitude: string | null;
    epicenter: string | null;
    depth: string | null;
    lat: number | null;
    lon: number | null;
    tsunami: string | null;
    intensityAreas: Array<{ code: string; maxIntensity: string | null }>;
  }>;
}> {
  const cached = await readCachedQuakes();
  const initialState = await readJmaState();
  const shouldBlock =
    !cached.updatedAt ||
    msSince(cached.updatedAt) > WEBJSON_INTERVALS_MS.quakeList ||
    isOlderThan(cached.updatedAt, initialState.webjson.quakeList.lastSuccessfulUpdateTime) ||
    isOlderThan(cached.updatedAt, initialState.feeds.eqvol.lastSuccessfulUpdateTime);

  if (shouldBlock) {
    await triggerQuakesRefresh(true);
  } else {
    void triggerQuakesRefresh(false);
  }

  const refreshed = shouldBlock ? await readCachedQuakes() : cached;
  const state = await readJmaState();

  const hasWebItems = refreshed.items.some((i: any) => i?.source === 'webjson');
  const hasPullItems = refreshed.items.some((i: any) => i?.source === 'pull');
  const source: 'webjson' | 'pull' = hasWebItems
    ? 'webjson'
    : hasPullItems
      ? 'pull'
      : state.webjson.quakeList.lastSuccessfulUpdateTime
        ? 'webjson'
        : 'pull';

  const meta = source === 'webjson' ? state.webjson.quakeList : state.feeds.eqvol;
  const fetchStatus = computeFetchStatus(meta.lastSuccessfulUpdateTime, meta.lastError);
  const updatedAt = refreshed.updatedAt ?? meta.lastSuccessfulUpdateTime;
  const lastError = meta.lastError;

  const items = refreshed.items.map(({ source: _source, ...rest }: any) => rest);
  return { fetchStatus, updatedAt, lastError, items };
}

export async function getJmaWarnings(area: string): Promise<{
  fetchStatus: FetchStatus;
  updatedAt: string | null;
  lastError: string | null;
  area: string;
  areaName: string | null;
  confidence: 'HIGH' | 'LOW';
  confidenceNotes: string[];
  items: NormalizedWarningItem[];
}> {
  const cached = await readCachedWarnings();
  const initialState = await readJmaState();
  const initialAreaSnap = cached.areas[area] ?? null;
  const initialWebState = initialState.webjson.warningsByArea[area] ?? null;
  const shouldBlock =
    !initialAreaSnap ||
    msSince(initialAreaSnap.updatedAt) > WEBJSON_INTERVALS_MS.warningArea ||
    isOlderThan(initialAreaSnap.updatedAt, initialState.feeds.regular.lastSuccessfulUpdateTime) ||
    isOlderThan(initialAreaSnap.updatedAt, initialState.feeds.extra.lastSuccessfulUpdateTime) ||
    isOlderThan(initialAreaSnap.updatedAt, initialWebState?.lastSuccessfulUpdateTime);

  if (shouldBlock) {
    await triggerWarningsRefresh(area, true);
  } else {
    void triggerWarningsRefresh(area, false);
  }

  const refreshed = shouldBlock ? await readCachedWarnings() : cached;
  const state = await readJmaState();

  const regularStatus = computeFetchStatus(
    state.feeds.regular.lastSuccessfulUpdateTime,
    state.feeds.regular.lastError
  );
  const extraStatus = computeFetchStatus(state.feeds.extra.lastSuccessfulUpdateTime, state.feeds.extra.lastError);
  const webState = state.webjson.warningsByArea[area] ?? null;
  const webStatus = computeFetchStatus(webState?.lastSuccessfulUpdateTime ?? null, webState?.lastError ?? null);

  const fetchStatus: FetchStatus =
    regularStatus === 'OK' || extraStatus === 'OK' || webStatus === 'OK' ? 'OK' : 'DEGRADED';
  const lastError =
    fetchStatus === 'DEGRADED'
      ? state.feeds.regular.lastError ?? state.feeds.extra.lastError ?? webState?.lastError ?? null
      : null;

  const areaSnap = refreshed.areas[area] ?? null;
  const items = areaSnap?.items ?? [];
  const { confidence, confidenceNotes } = computeWarningsConfidence(area, items);
  return {
    fetchStatus,
    updatedAt: areaSnap?.updatedAt ?? null,
    lastError,
    area,
    areaName: areaSnap?.areaName ?? null,
    confidence,
    confidenceNotes,
    items,
  };
}

function computeWarningsConfidence(
  area: string,
  items: Array<{ source?: string | null }>
): { confidence: 'HIGH' | 'LOW'; confidenceNotes: string[] } {
  const notes: string[] = [];
  const isPrefLevel = /^\d{2}0000$/.test(area);
  if (isPrefLevel) notes.push('prefecture-level area code (XX0000)');

  const hasPullFallback = items.some((i) => i?.source === 'pull');
  if (hasPullFallback) notes.push('fallback from Atom entry titles (minimal normalization)');

  // Conservative: only treat as HIGH if not prefecture-level and not using pull fallback.
  const confidence: 'HIGH' | 'LOW' = !isPrefLevel && !hasPullFallback ? 'HIGH' : 'LOW';
  return { confidence, confidenceNotes: notes };
}

async function triggerStaleRefresh(feeds: JmaFeedKey[]): Promise<void> {
  for (const feed of feeds) {
    await refreshFeedIfStale(feed);
  }
}

async function triggerQuakesRefresh(blocking: boolean): Promise<void> {
  const run = async () => {
    const before = await readJmaState();
    const beforeSig = [
      `${before.feeds.eqvol.lastSuccessfulUpdateTime ?? ''}|${before.feeds.eqvol.lastError ?? ''}`,
      `${before.webjson.quakeList.lastSuccessfulUpdateTime ?? ''}|${before.webjson.quakeList.lastError ?? ''}`,
    ].join('||');
    await refreshFeedIfStale('eqvol');
    await refreshWebJsonQuakeListIfStale();
    const after = await readJmaState();
    const afterSig = [
      `${after.feeds.eqvol.lastSuccessfulUpdateTime ?? ''}|${after.feeds.eqvol.lastError ?? ''}`,
      `${after.webjson.quakeList.lastSuccessfulUpdateTime ?? ''}|${after.webjson.quakeList.lastError ?? ''}`,
    ].join('||');

    if (blocking || beforeSig !== afterSig) {
      await rebuildNormalizedQuakes();
    }

    if (blocking || beforeSig !== afterSig) {
      await rebuildNormalizedStatus();
    }
  };

  if (blocking) {
    await runExclusive('refresh:quakes', run, LOCK_TTLS_MS.normalize);
  } else {
    void runExclusive('refresh:quakes', run, LOCK_TTLS_MS.normalize);
  }
}

async function triggerWarningsRefresh(area: string, blocking: boolean): Promise<void> {
  const run = async () => {
    const before = await readJmaState();
    const beforeSig = [
      `${before.feeds.regular.lastSuccessfulUpdateTime ?? ''}|${before.feeds.regular.lastError ?? ''}`,
      `${before.feeds.extra.lastSuccessfulUpdateTime ?? ''}|${before.feeds.extra.lastError ?? ''}`,
      `${before.webjson.warningsByArea[area]?.lastSuccessfulUpdateTime ?? ''}|${
        before.webjson.warningsByArea[area]?.lastError ?? ''
      }`,
    ].join('||');

    await refreshFeedIfStale('regular');
    await refreshFeedIfStale('extra');
    await refreshWebJsonWarningAreaIfStale(area);

    const after = await readJmaState();
    const afterSig = [
      `${after.feeds.regular.lastSuccessfulUpdateTime ?? ''}|${after.feeds.regular.lastError ?? ''}`,
      `${after.feeds.extra.lastSuccessfulUpdateTime ?? ''}|${after.feeds.extra.lastError ?? ''}`,
      `${after.webjson.warningsByArea[area]?.lastSuccessfulUpdateTime ?? ''}|${
        after.webjson.warningsByArea[area]?.lastError ?? ''
      }`,
    ].join('||');

    if (blocking || beforeSig !== afterSig) {
      await updateNormalizedWarningsArea(area);
      await rebuildNormalizedStatus();
    }
  };

  if (blocking) {
    await runExclusive(`refresh:warnings:${area}`, run, LOCK_TTLS_MS.normalize);
  } else {
    void runExclusive(`refresh:warnings:${area}`, run, LOCK_TTLS_MS.normalize);
  }
}
