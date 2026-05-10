import type { NextApiRequest, NextApiResponse } from 'next';
import { getDeviceState, updateDeviceState } from 'lib/store/adapter';
import { DeviceIdSchema, UpdateDeviceBodySchema } from 'lib/store/types';
import { assertSameOrigin, jsonError, jsonOk, rateLimit } from 'lib/server/security';

export const config = {
  api: {
    bodyParser: { sizeLimit: '32kb' },
  },
};

const WRITE_RATE_LIMIT = { keyPrefix: 'write:device', limit: 30, windowMs: 5 * 60_000 };
const READ_RATE_LIMIT = { keyPrefix: 'read:device', limit: 120, windowMs: 60_000 };
const DEVICE_MESSAGE = '端末情報を準備できませんでした。ページを再読み込みしてください。';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'ORIGIN_BLOCKED', message: 'forbidden' });
      const rl = rateLimit(req, READ_RATE_LIMIT);
      if (!rl.ok) {
        res.setHeader('Retry-After', String(rl.retryAfterSec));
        return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED', message: 'rate_limited' });
      }
      const deviceIdQuery = Array.isArray(req.query.deviceId) ? req.query.deviceId[0] : req.query.deviceId;
      const deviceIdBody = req.body && typeof req.body === 'object' ? (req.body as any).deviceId : undefined;
      const deviceId = (deviceIdQuery ?? deviceIdBody) as string | undefined;
      const parsed = DeviceIdSchema.safeParse(deviceId);
      if (!parsed.success) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY', message: DEVICE_MESSAGE });
      const device = await getDeviceState(parsed.data);
      return jsonOk(res, { device });
    }

    if (req.method === 'POST') {
      if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'ORIGIN_BLOCKED', message: 'forbidden' });
      const rl = rateLimit(req, WRITE_RATE_LIMIT);
      if (!rl.ok) {
        res.setHeader('Retry-After', String(rl.retryAfterSec));
        return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED', message: 'rate_limited' });
      }

      const parsed = UpdateDeviceBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY', message: DEVICE_MESSAGE });
      }
      const { deviceId, settings, savedAreas, favorites, recent } = parsed.data;
      if (savedAreas && savedAreas.length > 20) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'PAYLOAD_TOO_LARGE', message: 'payload_too_large' });
      if (favorites?.shelterIds && favorites.shelterIds.length > 200) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'PAYLOAD_TOO_LARGE', message: 'payload_too_large' });
      if (recent?.shelterIds && recent.shelterIds.length > 200) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'PAYLOAD_TOO_LARGE', message: 'payload_too_large' });
      const device = await updateDeviceState(deviceId, { settings, savedAreas, favorites: favorites as any, recent: recent as any });
      return jsonOk(res, { device });
    }

    return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : null;
    console.warn('[store:device] unhandled_error', { code, error: message });
    return jsonError(res, 500, { ok: false, error: 'internal_error', errorCode: 'INTERNAL_ERROR', message: DEVICE_MESSAGE, device: null });
  }
}
