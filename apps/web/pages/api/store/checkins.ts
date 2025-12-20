import type { NextApiRequest, NextApiResponse } from 'next';
import { getAdminState, listCheckinPins } from 'lib/store/adapter';

function first(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const includeHistory = first(req.query.includeHistory) === '1';
  const includeOld = first(req.query.includeOld) === '1';
  const statuses = (first(req.query.status) ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 10);

  try {
    const [pins, admin] = await Promise.all([
      listCheckinPins({ includeHistory, includeOld, statuses }),
      getAdminState(),
    ]);

    return res.status(200).json({
      fetchStatus: 'OK',
      updatedAt: pins.updatedAt,
      lastError: null,
      moderationPolicy: admin.moderationPolicy,
      pins: pins.pins,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const admin = await getAdminState().catch(() => null);
    return res.status(200).json({
      fetchStatus: 'DOWN',
      updatedAt: null,
      lastError: message,
      moderationPolicy: admin?.moderationPolicy ?? null,
      pins: [],
    });
  }
}
