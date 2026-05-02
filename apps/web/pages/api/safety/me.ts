import type { NextApiRequest, NextApiResponse } from 'next';
import { getDeviceState } from 'lib/store/adapter';
import { DeviceIdSchema } from 'lib/store/types';
import { assertSameOrigin, rateLimit } from 'lib/server/security';

const READ_RATE_LIMIT = { keyPrefix: 'read:safety_me', limit: 60, windowMs: 60_000 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  if (!assertSameOrigin(req)) return res.status(403).json({ error: 'forbidden' });

  const rl = rateLimit(req, READ_RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return res.status(429).json({ error: 'rate_limited' });
  }

  const deviceId = (Array.isArray(req.query.deviceId) ? req.query.deviceId[0] : req.query.deviceId) as string | undefined;
  const deviceHashLegacy = (Array.isArray(req.query.device_hash) ? req.query.device_hash[0] : req.query.device_hash) as string | undefined;
  const parsed = DeviceIdSchema.safeParse(deviceId ?? deviceHashLegacy);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'invalid_device_id' });
  }

  try {
    const device = await getDeviceState(parsed.data);
    return res.status(200).json({ ok: true, device });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[safety:me] read_failed', { error: message });
    return res.status(503).json({ ok: false, error: 'safety_status_unavailable' });
  }
}
