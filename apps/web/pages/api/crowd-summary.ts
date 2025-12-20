import type { NextApiRequest, NextApiResponse } from 'next';
import { getShelterCommunitySnapshot } from 'lib/store/adapter';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const siteId = req.query.siteId as string;
  if (!siteId) {
    return res.status(400).json({ error: 'siteId is required' });
  }

  const community = await getShelterCommunitySnapshot(siteId);
  const sinceMs = Date.now() - 60 * 60 * 1000;
  const summary = community.votes
    .filter((v) => Date.parse(v.createdAt) >= sinceMs)
    .reduce<Record<string, number>>((acc, v) => {
      acc[v.value] = (acc[v.value] ?? 0) + 1;
      return acc;
    }, {});

  const count = Object.values(summary).reduce((a, b) => a + b, 0);
  res.status(200).json({ summary, count });
}
