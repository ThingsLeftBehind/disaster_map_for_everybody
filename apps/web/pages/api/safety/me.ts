import type { NextApiRequest, NextApiResponse } from 'next';
import { getDeviceState } from 'lib/store/adapter';
import { DeviceIdSchema } from 'lib/store/types';
import { assertSameOrigin, rateLimit } from 'lib/server/security';

const READ_RATE_LIMIT = { keyPrefix: 'read:safety_me', limit: 60, windowMs: 60_000 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!assertSameOrigin(req)) return res.status(403).json({ error: 'forbidden' });

  const rl = rateLimit(req, READ_RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return res.status(429).json({ error: 'rate_limited' });
  }

  const device_hash = req.query.device_hash as string;
  if (!device_hash) {
    return res.status(400).json({ error: 'device_hash is required' });
  }
  const parsed = DeviceIdSchema.safeParse(device_hash);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_device_hash' });
  }

  const device = await getDeviceState(parsed.data);
  res.status(200).json({ device });
}
