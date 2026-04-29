import { LOCK_TTLS_MS, WEBJSON_ENDPOINTS, WEBJSON_INTERVALS_MS } from './config';
import { atomicWriteJson, readJsonFile, readTextFile } from './cache';
import { runExclusive } from './lock';
import { jmaWebJsonQuakeListPath, jmaWebJsonWarningPath } from './paths';
import { readJmaState, updateJmaState } from './state';

function nowIso(): string {
  return new Date().toISOString();
}

function countJsonItems(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  const seen = new Set<unknown>();
  let count = 0;
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray((node as any).warnings)) count += (node as any).warnings.length;
    for (const v of Object.values(node as Record<string, unknown>)) walk(v);
  };
  walk(value);
  return count;
}

function msSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Date.now() - t;
}

export async function readCachedWebJson<T>(path: string): Promise<T | null> {
  return readJsonFile<T>(path);
}

async function refreshWebJson(
  key: string,
  url: string,
  cachePath: string,
  stateAccessor: (draft: any) => any,
  intervalMs: number
): Promise<void> {
  const state = await readJmaState();
  const node = stateAccessor(state);
  const stale = msSince(node.lastSuccessfulUpdateTime) > intervalMs;
  const recentlyAttempted = msSince(node.lastAttemptTime) <= intervalMs;
  if (!stale || recentlyAttempted) return;

  await runExclusive(`webjson:${key}`, async () => {
    const startedAt = Date.now();
    const freshState = await readJmaState();
    const freshNode = stateAccessor(freshState);
    const stillStale = msSince(freshNode.lastSuccessfulUpdateTime) > intervalMs;
    const stillRecentlyAttempted = msSince(freshNode.lastAttemptTime) <= intervalMs;
    if (!stillStale || stillRecentlyAttempted) return;

    await updateJmaState((draft) => {
      const draftNode = stateAccessor(draft);
      draftNode.lastAttemptTime = nowIso();
      draftNode.lastError = null;
    });

    const headers: Record<string, string> = {};
    if (freshNode.etag) headers['If-None-Match'] = freshNode.etag;
    if (freshNode.lastModified) headers['If-Modified-Since'] = freshNode.lastModified;

    try {
      console.info('[jma:webjson] fetch:start', { key, url });
      const resp = await fetch(url, { headers, cache: 'no-store' });
      const durationMs = Date.now() - startedAt;
      if (resp.status === 304) {
        const cached = await readJsonFile<unknown>(cachePath);
        await updateJmaState((draft) => {
          const draftNode = stateAccessor(draft);
          draftNode.lastSuccessfulUpdateTime = nowIso();
          draftNode.lastError = null;
          draftNode.lastHttpStatus = resp.status;
          draftNode.lastItemCount = countJsonItems(cached);
          draftNode.lastDurationMs = durationMs;
        });
        console.info('[jma:webjson] fetch:not-modified', {
          key,
          httpStatus: resp.status,
          itemCount: countJsonItems(cached),
          durationMs,
        });
        return;
      }

      if (!resp.ok) {
        await updateJmaState((draft) => {
          const draftNode = stateAccessor(draft);
          draftNode.lastError = `HTTP ${resp.status} ${resp.statusText}`.trim();
          draftNode.lastHttpStatus = resp.status;
          draftNode.lastDurationMs = durationMs;
        });
        console.warn('[jma:webjson] fetch:failed', { key, httpStatus: resp.status, durationMs });
        return;
      }

      const text = await resp.text();
      const parsed = JSON.parse(text) as unknown;
      const itemCount = countJsonItems(parsed);
      await atomicWriteJson(cachePath, parsed);
      await updateJmaState((draft) => {
        const draftNode = stateAccessor(draft);
        draftNode.etag = resp.headers.get('etag');
        draftNode.lastModified = resp.headers.get('last-modified');
        draftNode.lastSuccessfulUpdateTime = nowIso();
        draftNode.lastError = null;
        draftNode.lastHttpStatus = resp.status;
        draftNode.lastItemCount = itemCount;
        draftNode.lastDurationMs = durationMs;
      });
      console.info('[jma:webjson] fetch:success', { key, httpStatus: resp.status, itemCount, durationMs });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      await updateJmaState((draft) => {
        const draftNode = stateAccessor(draft);
        draftNode.lastError = error instanceof Error ? error.message : String(error);
        draftNode.lastDurationMs = durationMs;
      });
      console.warn('[jma:webjson] fetch:error', {
        key,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }, LOCK_TTLS_MS.webjson);
}

export async function refreshWebJsonQuakeListIfStale(): Promise<void> {
  await refreshWebJson(
    'quakeList',
    WEBJSON_ENDPOINTS.quakeList,
    jmaWebJsonQuakeListPath(),
    (draft) => draft.webjson.quakeList,
    WEBJSON_INTERVALS_MS.quakeList
  );
}

export async function refreshWebJsonWarningAreaIfStale(area: string): Promise<void> {
  await refreshWebJson(
    `warning:${area}`,
    WEBJSON_ENDPOINTS.warningArea(area),
    jmaWebJsonWarningPath(area),
    (draft) => {
      draft.webjson.warningsByArea[area] ??= {
        lastAttemptTime: null,
        lastSuccessfulUpdateTime: null,
        lastError: null,
        lastHttpStatus: null,
        lastItemCount: null,
        lastDurationMs: null,
        etag: null,
        lastModified: null,
      };
      return draft.webjson.warningsByArea[area];
    },
    WEBJSON_INTERVALS_MS.warningArea
  );
}

export async function readRawWebJsonText(cachePath: string): Promise<string | null> {
  return readTextFile(cachePath);
}
