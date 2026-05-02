import type { NextApiRequest, NextApiResponse } from 'next';
import { getAdminState, listCheckinPins } from 'lib/store/adapter';

function first(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const window = first(req.query.window) === '3d' ? '3d' : '24h';
  const statuses = (first(req.query.status) ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 10);

  try {
    const [pins, admin] = await Promise.all([
      listCheckinPins({ window, statuses }),
      getAdminState(),
    ]);

    return res.status(200).json({
      fetchStatus: 'OK',
      updatedAt: pins.updatedAt,
      lastError: null,
      window,
      moderationPolicy: admin.moderationPolicy,
      pins: pins.pins,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[store:checkins] read_failed', { error: message });
    const admin = await getAdminState().catch(() => null);
    return res.status(503).json({
      fetchStatus: 'DOWN',
      updatedAt: null,
      lastError: 'checkins_unavailable',
      window,
      moderationPolicy: admin?.moderationPolicy ?? null,
      pins: [],
    });
  }
}
