import type { NextApiRequest, NextApiResponse } from 'next';
import { getJmaStatus } from 'lib/jma/service';
import { readJmaState } from 'lib/jma/state';
import type { FetchStatus, JmaFeedKey } from 'lib/jma/types';

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = await getJmaStatus();
    return res.status(200).json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
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
            },
          ];
        })
      ) as Record<JmaFeedKey, { fetchStatus: FetchStatus; updatedAt: string | null; lastError: string | null }>;

      const updatedAt = (Object.keys(feeds) as JmaFeedKey[]).reduce<string | null>(
        (acc, feed) => maxIso(acc, feeds[feed].updatedAt),
        null
      );

      return res.status(200).json({
        fetchStatus: 'DEGRADED',
        updatedAt,
        lastError: message,
        feeds,
      });
    } catch {
      return res.status(200).json({
        fetchStatus: 'DEGRADED',
        updatedAt: null,
        lastError: message,
        feeds: {
          regular: { fetchStatus: 'DEGRADED', updatedAt: null, lastError: message },
          extra: { fetchStatus: 'DEGRADED', updatedAt: null, lastError: message },
          eqvol: { fetchStatus: 'DEGRADED', updatedAt: null, lastError: message },
          other: { fetchStatus: 'DEGRADED', updatedAt: null, lastError: message },
        },
      });
    }
  }
}
