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
  if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'FORBIDDEN', message: 'forbidden' });
  if (req.method !== 'GET') {
    return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
  }
  const rl = rateLimit(req, READ_RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED', message: 'rate_limited' });
  }
  const parsedDevice = DeviceIdSchema.safeParse(first(req.query.deviceId));
  if (!parsedDevice.success) {
    return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_PAYLOAD', message: '端末情報を準備できませんでした。ページを再読み込みしてください。' });
  }
  try {
    const status = await getPushSubscriptionStatus(parsedDevice.data);
    return jsonOk(res, { ok: true, ...status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : null;
    console.warn('[push:status] failed', { code, error: message });
    return jsonError(res, 500, { ok: false, error: 'status_failed', errorCode: 'STATUS_FAILED', message: '通知の状態を取得できませんでした。' });
  }
}
