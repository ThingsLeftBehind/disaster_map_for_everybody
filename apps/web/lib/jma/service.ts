import { LOCK_TTLS_MS } from './config';
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

export async function getJmaStatus(): Promise<{
  fetchStatus: FetchStatus;
  updatedAt: string | null;
  lastError: string | null;
  feeds: Record<JmaFeedKey, { fetchStatus: FetchStatus; updatedAt: string | null; lastError: string | null }>;
}> {
  const state = await readJmaState();
  const cached = await readCachedStatus();

  const feeds = Object.fromEntries(
    (Object.keys(state.feeds) as JmaFeedKey[]).map((feed) => {
      const s = state.feeds[feed];
      return [
        feed,
        {
          fetchStatus: computeFetchStatus(s.lastSuccessfulUpdateTime, s.lastError),
          updatedAt: s.lastSuccessfulUpdateTime,
          lastError: s.lastError,
        },
      ];
    })
  ) as Record<JmaFeedKey, { fetchStatus: FetchStatus; updatedAt: string | null; lastError: string | null }>;

  const updatedAt = (Object.keys(feeds) as JmaFeedKey[]).reduce<string | null>(
    (acc, feed) => maxIso(acc, feeds[feed].updatedAt),
    cached?.updatedAt ?? null
  );

  const lastError =
    (Object.keys(feeds) as JmaFeedKey[]).map((f) => feeds[f].lastError).find(Boolean) ?? null;

  const fetchStatus: FetchStatus =
    (Object.values(feeds) as Array<{ fetchStatus: FetchStatus }>).some((f) => f.fetchStatus === 'DEGRADED')
      ? 'DEGRADED'
      : 'OK';

  void triggerStaleRefresh(['regular', 'extra', 'eqvol', 'other']);
  void runExclusive('normalize:status', () => rebuildNormalizedStatus(), LOCK_TTLS_MS.normalize);

  return { fetchStatus, updatedAt, lastError, feeds };
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
    depthKm: number | null;
    intensityAreas?: Array<{ intensity: string; areas: string[] }>;
  }>;
}> {
  const cached = await readCachedQuakes();

  if (!cached.updatedAt) {
    await triggerQuakesRefresh(true);
  } else {
    void triggerQuakesRefresh(false);
  }

  const refreshed = cached.updatedAt ? cached : await readCachedQuakes();
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

  const areaSnap = cached.areas[area] ?? null;
  if (!areaSnap) {
    await triggerWarningsRefresh(area, true);
    const refreshed = await readCachedWarnings();
    const refreshedArea = refreshed.areas[area];
    const items = refreshedArea?.items ?? [];
    const { confidence, confidenceNotes } = computeWarningsConfidence(area, items);
    return {
      fetchStatus,
      updatedAt: refreshedArea?.updatedAt ?? null,
      lastError,
      area,
      areaName: refreshedArea?.areaName ?? null,
      confidence,
      confidenceNotes,
      items,
    };
  }

  void triggerWarningsRefresh(area, false);
  const { confidence, confidenceNotes } = computeWarningsConfidence(area, areaSnap.items);
  return {
    fetchStatus,
    updatedAt: areaSnap.updatedAt,
    lastError,
    area,
    areaName: areaSnap.areaName,
    confidence,
    confidenceNotes,
    items: areaSnap.items,
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
