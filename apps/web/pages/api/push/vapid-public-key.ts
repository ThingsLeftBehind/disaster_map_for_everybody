import type { NextApiRequest, NextApiResponse } from 'next';
import { jsonError, jsonOk, rateLimit } from 'lib/server/security';
import { getVapidPublicKey } from 'lib/server/push';

const READ_RATE_LIMIT = { keyPrefix: 'read:vapid-public-key', limit: 120, windowMs: 60_000 };

function isValidVapidPublicKey(value: string): boolean {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const buffer = Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64');
    return buffer.byteLength === 65 && buffer[0] === 4;
  } catch {
    return false;
  }
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
  }
  const rl = rateLimit(req, READ_RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED', message: 'rate_limited' });
  }
  const publicKey = getVapidPublicKey();
  if (!publicKey || !isValidVapidPublicKey(publicKey)) {
    return jsonError(res, 503, { ok: false, error: 'vapid_not_configured', errorCode: 'VAPID_NOT_CONFIGURED', message: '通知の設定が未完了です。' });
  }
  return jsonOk(res, { ok: true, publicKey });
}
