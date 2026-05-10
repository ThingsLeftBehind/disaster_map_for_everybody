import type { NextApiRequest, NextApiResponse } from 'next';
import { DeviceIdSchema } from 'lib/store/types';
import { assertSameOrigin, jsonError, jsonOk, rateLimit } from 'lib/server/security';
import { createWatchRegion, listWatchRegions, WatchRegionApiError } from 'lib/server/watchRegions';

export const config = {
  api: {
    bodyParser: { sizeLimit: '32kb' },
  },
};

const READ_RATE_LIMIT = { keyPrefix: 'read:watch-regions', limit: 120, windowMs: 60_000 };
const WRITE_RATE_LIMIT = { keyPrefix: 'write:watch-regions', limit: 30, windowMs: 5 * 60_000 };
const DEVICE_ERROR = {
  ok: false,
  error: '端末情報を準備できませんでした。ページを再読み込みしてください。',
  errorCode: 'device_failed',
  message: '端末情報を準備できませんでした。ページを再読み込みしてください。',
};

function first(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function parseDeviceId(req: NextApiRequest): string | null {
  const fromQuery = first(req.query.deviceId);
  const fromBody = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).deviceId : undefined;
  const parsed = DeviceIdSchema.safeParse(fromQuery ?? fromBody);
  return parsed.success ? parsed.data : null;
}

function safeApiError(res: NextApiResponse, error: unknown, action: 'read' | 'save'): void {
  if (error instanceof WatchRegionApiError) {
    jsonError(res, error.status, { ok: false, error: error.message, errorCode: error.errorCode, message: error.message });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : null;
  console.warn('[watch-regions] unhandled_error', { action, code, error: message });
  const userMessage = action === 'save' ? '場所を保存できませんでした。' : '読み込みに失敗しました。';
  jsonError(res, 500, {
    ok: false,
    error: action === 'save' ? 'save_failed' : 'internal_error',
    errorCode: action === 'save' ? 'save_failed' : 'internal_error',
    message: userMessage,
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'forbidden', message: 'forbidden' });

  try {
    if (req.method === 'GET') {
      const rl = rateLimit(req, READ_RATE_LIMIT);
      if (!rl.ok) {
        res.setHeader('Retry-After', String(rl.retryAfterSec));
        return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'rate_limited', message: 'rate_limited' });
      }

      const deviceId = parseDeviceId(req);
      if (!deviceId) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'invalid_payload', message: '端末情報を準備できませんでした。ページを再読み込みしてください。' });

      const regions = await listWatchRegions(deviceId);
      return jsonOk(res, { ok: true, regions });
    }

    if (req.method === 'POST') {
      const rl = rateLimit(req, WRITE_RATE_LIMIT);
      if (!rl.ok) {
        res.setHeader('Retry-After', String(rl.retryAfterSec));
        return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'rate_limited', message: 'rate_limited' });
      }

      const deviceId = parseDeviceId(req);
      if (!deviceId) return jsonError(res, 400, DEVICE_ERROR);

      const region = await createWatchRegion(deviceId, req.body);
      return jsonOk(res, { ok: true, region });
    }

    return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'method_not_allowed', message: 'method_not_allowed' });
  } catch (error) {
    return safeApiError(res, error, req.method === 'POST' ? 'save' : 'read');
  }
}
