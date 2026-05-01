import type { NextApiRequest, NextApiResponse } from 'next';
import { getAdminState, getShelterCommunitySnapshot, summarizeShelterCommunityForDevice } from 'lib/store/adapter';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const shelterId = (Array.isArray(req.query.id) ? req.query.id[0] : req.query.id) as string | undefined;
    if (!shelterId) return res.status(400).json({ error: 'id is required' });
    const deviceId = (Array.isArray(req.query.deviceId) ? req.query.deviceId[0] : req.query.deviceId) as string | undefined;

    const [community, admin] = await Promise.all([getShelterCommunitySnapshot(shelterId), getAdminState()]);

    return res.status(200).json(summarizeShelterCommunityForDevice(community, admin, deviceId ?? null));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[store:shelter] read_failed', { error: message });
    return res.status(500).json({
      ok: false,
      updatedAt: null,
      moderationPolicy: null,
      votesSummary: {},
      contributorCount: 0,
      currentUserVote: null,
      commentCount: 0,
      hiddenCount: 0,
      mostReported: 0,
      commentsCollapsed: false,
      comments: [],
      lastError: 'community_unavailable',
    });
  }
}
