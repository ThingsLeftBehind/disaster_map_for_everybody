import { z } from 'zod';

export type FetchStatus = 'OK' | 'DEGRADED';

export const JmaFeedKeySchema = z.enum(['regular', 'extra', 'eqvol', 'other']);
export type JmaFeedKey = z.infer<typeof JmaFeedKeySchema>;

export const JmaWarningsQuerySchema = z.object({
  area: z.preprocess((value) => (Array.isArray(value) ? value[0] : value), z.string().regex(/^\d{6}$/)),
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
  etag: string | null;
  lastModified: string | null;
};

export type JmaWebJsonState = {
  lastAttemptTime: string | null;
  lastSuccessfulUpdateTime: string | null;
  lastError: string | null;
  etag: string | null;
  lastModified: string | null;
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
  depthKm: number | null;
  intensityAreas?: Array<{ intensity: string; areas: string[] }>;
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
    }
  >;
  webjson: {
    quakeList: {
      fetchStatus: FetchStatus;
      updatedAt: string | null;
      lastError: string | null;
    };
  };
};
