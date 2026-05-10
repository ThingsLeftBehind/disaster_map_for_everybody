import type { NextApiRequest, NextApiResponse } from 'next';
import { DeviceIdSchema } from 'lib/store/types';
import { assertSameOrigin, jsonError, jsonOk, rateLimit } from 'lib/server/security';
import { listWatchRegions } from 'lib/server/watchRegions';
import { resolveRegionStatus } from 'lib/server/watchRegionStatus';

const READ_RATE_LIMIT = { keyPrefix: 'read:watch-region-status', limit: 60, windowMs: 60_000 };

function first(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function parseDeviceId(req: NextApiRequest): string | null {
  const parsed = DeviceIdSchema.safeParse(first(req.query.deviceId));
  return parsed.success ? parsed.data : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'forbidden', message: 'forbidden' });

  if (req.method !== 'GET') {
    return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'method_not_allowed', message: 'method_not_allowed' });
  }

  const rl = rateLimit(req, READ_RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'rate_limited', message: 'rate_limited' });
  }

  const deviceId = parseDeviceId(req);
  if (!deviceId) {
    return jsonError(res, 400, {
      ok: false,
      error: 'invalid_payload',
      errorCode: 'invalid_payload',
      message: '端末情報を準備できませんでした。ページを再読み込みしてください。',
    });
  }

  try {
    const regions = await listWatchRegions(deviceId);
    const withStatus = await Promise.all(regions.map((region) => resolveRegionStatus(region)));
    return jsonOk(res, { ok: true, updatedAt: new Date().toISOString(), regions: withStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : null;
    console.warn('[watch-region-status] unhandled_error', { code, error: message });
    return jsonError(res, 500, { ok: false, error: 'internal_error', errorCode: 'internal_error', message: '登録済みの場所の状態を取得できませんでした。' });
  }
}
