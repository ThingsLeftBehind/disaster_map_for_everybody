import type { NextApiRequest, NextApiResponse } from 'next';
import { JmaRawQuerySchema } from 'lib/jma/types';
import { readJmaState } from 'lib/jma/state';
import { readTextFile } from 'lib/jma/cache';
import { jmaFeedXmlPath } from 'lib/jma/paths';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const parsed = JmaRawQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() });
  }

  const { feed } = parsed.data;
  try {
    const state = await readJmaState();
    const meta = state.feeds[feed];
    const xml = await readTextFile(jmaFeedXmlPath(feed));

    const fetchStatus = meta.lastSuccessfulUpdateTime && !meta.lastError ? 'OK' : 'DEGRADED';
    return res.status(200).json({
      fetchStatus,
      updatedAt: meta.lastSuccessfulUpdateTime,
      lastError: meta.lastError,
      feed,
      xml,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(200).json({
      fetchStatus: 'DEGRADED',
      updatedAt: null,
      lastError: message,
      feed,
      xml: null,
    });
  }
}
