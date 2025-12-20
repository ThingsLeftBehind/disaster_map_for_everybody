import type { JmaFeedKey } from './types';

export const JMA_FEEDS: Record<
  JmaFeedKey,
  {
    url: string;
    intervalMs: number;
  }
> = {
  regular: {
    url: 'https://www.data.jma.go.jp/developer/xml/feed/regular.xml',
    intervalMs: 180_000,
  },
  extra: {
    url: 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml',
    intervalMs: 60_000,
  },
  eqvol: {
    url: 'https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml',
    intervalMs: 60_000,
  },
  other: {
    url: 'https://www.data.jma.go.jp/developer/xml/feed/other.xml',
    intervalMs: 180_000,
  },
};

export const WEBJSON_ENDPOINTS = {
  quakeList: 'https://www.jma.go.jp/bosai/quake/data/list.json',
  warningArea: (area: string) => `https://www.jma.go.jp/bosai/warning/data/warning/${area}.json`,
} as const;

export const WEBJSON_INTERVALS_MS = {
  quakeList: 60_000,
  warningArea: 60_000,
} as const;

export const LOCK_TTLS_MS = {
  state: 10_000,
  feed: 5 * 60_000,
  webjson: 2 * 60_000,
  normalize: 30_000,
} as const;

export const NORMALIZATION_LIMITS = {
  atomEntriesPerFeed: 60,
  newEntryDownloadsPerRefresh: 20,
  quakesItems: 50,
} as const;

