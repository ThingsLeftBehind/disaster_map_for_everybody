import type { NextApiRequest, NextApiResponse } from 'next';
import { DeviceIdSchema } from 'lib/store/types';
import { assertSameOrigin, jsonError, jsonOk, rateLimit } from 'lib/server/security';
import { disablePushSubscription } from 'lib/server/push';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

const WRITE_RATE_LIMIT = { keyPrefix: 'write:push-unsubscribe', limit: 30, windowMs: 5 * 60_000 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'FORBIDDEN' });
  if (req.method !== 'POST') {
    return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });
  }
  const rl = rateLimit(req, WRITE_RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED' });
  }

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
  const parsedDevice = DeviceIdSchema.safeParse(body.deviceId);
  if (!parsedDevice.success) {
    return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_PAYLOAD' });
  }

  try {
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : null;
    const disabled = await disablePushSubscription({ deviceHash: parsedDevice.data, endpoint });
    return jsonOk(res, { ok: true, disabled });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[push:unsubscribe] failed', { error: message });
    return jsonError(res, 500, { ok: false, error: 'internal_error', errorCode: 'INTERNAL_ERROR' });
  }
}
