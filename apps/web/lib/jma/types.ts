import { z } from 'zod';

export type FetchStatus = 'OK' | 'DEGRADED' | 'DOWN';
export type SourceStatusLevel = 'ONLINE' | 'DELAYED' | 'OUTDATED' | 'UNAVAILABLE';

export const JmaFeedKeySchema = z.enum(['regular', 'extra', 'eqvol', 'other']);
export type JmaFeedKey = z.infer<typeof JmaFeedKeySchema>;

export const JmaWarningsQuerySchema = z.object({
  area: z.preprocess((value) => (Array.isArray(value) ? value[0] : value), z.string().regex(/^\d{6}$/)),
  subArea: z.preprocess(
    (value) => {
      const raw = Array.isArray(value) ? value[0] : value;
      if (typeof raw !== 'string') return undefined;
      const trimmed = raw.trim();
      return trimmed ? trimmed : undefined;
    },
    z.string().regex(/^\d{6}$/).optional()
  ),
  class20: z.preprocess(
    (value) => {
      const raw = Array.isArray(value) ? value[0] : value;
      if (typeof raw !== 'string') return undefined;
      const trimmed = raw.trim();
      return trimmed ? trimmed : undefined;
    },
    z.string().regex(/^\d{5,7}$/).optional()
  ),
});

export const JmaRawQuerySchema = z.object({
  feed: z.preprocess((value) => (Array.isArray(value) ? value[0] : value), JmaFeedKeySchema),
});

export type JmaFeedState = {
  url: string;
  intervalMs: number;
  lastAttemptTime: string | null;
  lastSuccessfulUpdateTime: string | null;
  lastError: string | null;
  lastHttpStatus?: number | null;
  lastItemCount?: number | null;
  lastDurationMs?: number | null;
  etag: string | null;
  lastModified: string | null;
};

export type JmaWebJsonState = {
  lastAttemptTime: string | null;
  lastSuccessfulUpdateTime: string | null;
  lastError: string | null;
  lastHttpStatus?: number | null;
  lastItemCount?: number | null;
  lastDurationMs?: number | null;
  etag: string | null;
  lastModified: string | null;
};

export type JmaSourceStatusRecord = {
  source: 'jma';
  feed_family: string;
  status: SourceStatusLevel;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_http_status: number | null;
  last_item_count: number | null;
  last_duration_ms: number | null;
  stale_after_ms: number;
};

export type JmaState = {
  version: 1;
  feeds: Record<JmaFeedKey, JmaFeedState>;
  webjson: {
    quakeList: JmaWebJsonState;
    warningsByArea: Record<string, JmaWebJsonState>;
  };
};

export type AtomEntry = {
  id: string;
  title: string;
  updated: string | null;
  published: string | null;
  link: string | null;
};

export type NormalizedQuakeItem = {
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
  source: 'pull' | 'webjson';
};

export type NormalizedQuakesSnapshot = {
  updatedAt: string | null;
  items: NormalizedQuakeItem[];
};

export type NormalizedWarningItem = {
  id: string;
  kind: string;
  status: string | null;
  source: 'webjson' | 'pull';
  areaCode?: string | null;
  areaName?: string | null;
  tokyoGroup?: string | null;
};

export type NormalizedWarningsAreaSnapshot = {
  updatedAt: string | null;
  area: string;
  areaName: string | null;
  items: NormalizedWarningItem[];
};

export type NormalizedWarningsSnapshot = {
  updatedAt: string | null;
  areas: Record<string, NormalizedWarningsAreaSnapshot>;
};

export type NormalizedStatusSnapshot = {
  updatedAt: string | null;
  fetchStatus: FetchStatus;
  feeds: Record<
    JmaFeedKey,
    {
      fetchStatus: FetchStatus;
      updatedAt: string | null;
      lastError: string | null;
      stale: boolean;
      lastAttemptAt: string | null;
      lastHttpStatus: number | null;
      lastItemCount: number | null;
      lastDurationMs: number | null;
    }
  >;
  webjson: {
    quakeList: {
      fetchStatus: FetchStatus;
      updatedAt: string | null;
      lastError: string | null;
      stale: boolean;
      lastAttemptAt: string | null;
      lastHttpStatus: number | null;
      lastItemCount: number | null;
      lastDurationMs: number | null;
    };
  };
  sources: JmaSourceStatusRecord[];
};
