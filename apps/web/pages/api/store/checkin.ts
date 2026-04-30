import type { NextApiRequest, NextApiResponse } from 'next';
import { clearActiveCheckin, submitCheckinPin } from 'lib/store/adapter';
import { ipHash } from 'lib/store/security';
import { CheckinBodySchema, DeviceIdSchema } from 'lib/store/types';
import { assertSameOrigin, getClientIp, jsonError, jsonOk, rateLimit } from 'lib/server/security';

export const config = {
  api: {
    bodyParser: { sizeLimit: '32kb' },
  },
};

const WRITE_RATE_LIMIT = { keyPrefix: 'write:checkin', limit: 30, windowMs: 5 * 60_000 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'ORIGIN_BLOCKED' });

    const rl = rateLimit(req, WRITE_RATE_LIMIT);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED' });
    }

    if (req.method === 'DELETE') {
      const body = req.body && typeof req.body === 'object' ? (req.body as { deviceId?: unknown }) : {};
      const parsed = DeviceIdSchema.safeParse(body.deviceId);
      if (!parsed.success) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY' });
      const device = await clearActiveCheckin(parsed.data);
      return jsonOk(res, { device });
    }

    if (req.method !== 'POST') return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });

    const parsed = CheckinBodySchema.safeParse(req.body);
    if (!parsed.success) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY' });

    const comment = typeof parsed.data.comment === 'string' ? parsed.data.comment.trim() : null;
    if (comment && comment.length > 120) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'PAYLOAD_TOO_LARGE' });

    const ip = getClientIp(req);
    const result = await submitCheckinPin({
      deviceId: parsed.data.deviceId,
      ipHash: ipHash(ip),
      status: parsed.data.status,
      shelterId: parsed.data.shelterId,
      lat: parsed.data.lat,
      lon: parsed.data.lon,
      precision: parsed.data.precision === 'PRECISE' ? 'PRECISE' : 'COARSE',
      comment: comment || null,
    });
    if (!result.ok) {
      return jsonError(res, result.code === 'RATE_LIMITED' ? 429 : 400, {
        ok: false,
        error: result.message,
        code: result.code,
        errorCode: result.code,
      });
    }
    return jsonOk(res, { device: result.value });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[store:checkin] unhandled_error', { error: message });
    return jsonError(res, 500, { ok: false, error: 'internal_error', errorCode: 'INTERNAL_ERROR', device: null });
  }
}
