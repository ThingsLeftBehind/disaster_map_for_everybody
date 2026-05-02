import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveShelterPostsForDevice } from 'lib/store/adapter';

const ACTIVE_POST_LIMIT = 5;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });
  }

  const deviceId = (Array.isArray(req.query.deviceId) ? req.query.deviceId[0] : req.query.deviceId) as string | undefined;
  if (!deviceId) {
    return res.status(400).json({ ok: false, error: 'deviceId is required', errorCode: 'INVALID_QUERY' });
  }

  try {
    const activePosts = await getActiveShelterPostsForDevice(deviceId);
    return res.status(200).json({
      ok: true,
      updatedAt: new Date().toISOString(),
      activePostLimit: ACTIVE_POST_LIMIT,
      activePostCount: activePosts.length,
      activePosts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[store:shelter_active] read_failed', { error: message });
    return res.status(500).json({
      ok: false,
      error: 'active_posts_unavailable',
      errorCode: 'INTERNAL_ERROR',
      activePostLimit: ACTIVE_POST_LIMIT,
      activePostCount: 0,
      activePosts: [],
    });
  }
}
