import { JMA_FEEDS, LOCK_TTLS_MS } from './config';
import { readJsonFile, atomicWriteJson } from './cache';
import { runExclusive } from './lock';
import { jmaStateFilePath } from './paths';
import type { JmaFeedKey, JmaState } from './types';

function defaultFeedState(feed: JmaFeedKey) {
  return {
    url: JMA_FEEDS[feed].url,
    intervalMs: JMA_FEEDS[feed].intervalMs,
    lastAttemptTime: null,
    lastSuccessfulUpdateTime: null,
    lastError: null,
    etag: null,
    lastModified: null,
  };
}

export function defaultJmaState(): JmaState {
  return {
    version: 1,
    feeds: {
      regular: defaultFeedState('regular'),
      extra: defaultFeedState('extra'),
      eqvol: defaultFeedState('eqvol'),
      other: defaultFeedState('other'),
    },
    webjson: {
      quakeList: {
        lastAttemptTime: null,
        lastSuccessfulUpdateTime: null,
        lastError: null,
        etag: null,
        lastModified: null,
      },
      warningsByArea: {},
    },
  };
}

export async function readJmaState(): Promise<JmaState> {
  const fromDisk = await readJsonFile<JmaState>(jmaStateFilePath());
  if (!fromDisk || fromDisk.version !== 1) return defaultJmaState();

  const merged = defaultJmaState();
  merged.feeds = { ...merged.feeds, ...fromDisk.feeds };
  merged.webjson = {
    quakeList: { ...merged.webjson.quakeList, ...fromDisk.webjson?.quakeList },
    warningsByArea: { ...fromDisk.webjson?.warningsByArea },
  };

  for (const feed of Object.keys(merged.feeds) as JmaFeedKey[]) {
    merged.feeds[feed].url = JMA_FEEDS[feed].url;
    merged.feeds[feed].intervalMs = JMA_FEEDS[feed].intervalMs;
  }

  return merged;
}

export async function writeJmaState(next: JmaState): Promise<void> {
  await atomicWriteJson(jmaStateFilePath(), next);
}

export async function updateJmaState(mutator: (state: JmaState) => void): Promise<JmaState> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const { executed, value } = await runExclusive(
      'state',
      async () => {
        const state = await readJmaState();
        mutator(state);
        await writeJmaState(state);
        return state;
      },
      LOCK_TTLS_MS.state
    );

    if (executed && value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  const bestEffort = await readJmaState();
  mutator(bestEffort);
  await writeJmaState(bestEffort);
  return bestEffort;
}
