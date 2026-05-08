import type { NextApiRequest, NextApiResponse } from 'next';
import { DeviceIdSchema } from 'lib/store/types';
import { assertSameOrigin, jsonError, jsonOk, rateLimit } from 'lib/server/security';
import { getPushSubscriptionStatus } from 'lib/server/push';

const READ_RATE_LIMIT = { keyPrefix: 'read:push-status', limit: 120, windowMs: 60_000 };

function first(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'FORBIDDEN' });
  if (req.method !== 'GET') {
    return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });
  }
  const rl = rateLimit(req, READ_RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED' });
  }
  const parsedDevice = DeviceIdSchema.safeParse(first(req.query.deviceId));
  if (!parsedDevice.success) {
    return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_PAYLOAD' });
  }
  try {
    const status = await getPushSubscriptionStatus(parsedDevice.data);
    return jsonOk(res, { ok: true, ...status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[push:status] failed', { error: message });
    return jsonError(res, 500, { ok: false, error: 'internal_error', errorCode: 'INTERNAL_ERROR' });
  }
}
