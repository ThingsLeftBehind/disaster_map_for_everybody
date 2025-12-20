import type { NextApiRequest, NextApiResponse } from 'next';
import { getJmaQuakes } from 'lib/jma/service';
import { readCachedQuakes } from 'lib/jma/normalize';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = await getJmaQuakes();
    return res.status(200).json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const cached = await readCachedQuakes();
      const updatedAt = cached.updatedAt ?? null;
      const items = (cached.items ?? []).map(({ source: _source, ...rest }: any) => rest);
      return res.status(200).json({
        fetchStatus: 'DEGRADED',
        updatedAt,
        lastError: message,
        items,
      });
    } catch {
      return res.status(200).json({
        fetchStatus: 'DEGRADED',
        updatedAt: null,
        lastError: message,
        items: [],
      });
    }
  }
}
