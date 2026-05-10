import type { NextApiRequest, NextApiResponse } from 'next';
import { DeviceIdSchema } from 'lib/store/types';
import { assertSameOrigin, jsonError, jsonOk, rateLimit } from 'lib/server/security';
import { disablePushSubscription } from 'lib/server/push';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

const WRITE_RATE_LIMIT = { keyPrefix: 'write:push-unsubscribe', limit: 30, windowMs: 5 * 60_000 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'FORBIDDEN', message: 'forbidden' });
  if (req.method !== 'POST') {
    return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
  }
  const rl = rateLimit(req, WRITE_RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED', message: 'rate_limited' });
  }

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
  const parsedDevice = DeviceIdSchema.safeParse(body.deviceId);
  if (!parsedDevice.success) {
    return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_PAYLOAD', message: '端末情報を準備できませんでした。ページを再読み込みしてください。' });
  }

  try {
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : null;
    const disabled = await disablePushSubscription({ deviceHash: parsedDevice.data, endpoint });
    return jsonOk(res, { ok: true, disabled });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : null;
    console.warn('[push:unsubscribe] failed', { code, error: message });
    return jsonError(res, 500, { ok: false, error: 'unsubscribe_failed', errorCode: 'UNSUBSCRIBE_FAILED', message: '通知を停止できませんでした。' });
  }
}
