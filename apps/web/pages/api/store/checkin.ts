import type { NextApiRequest, NextApiResponse } from 'next';
import { submitCheckinPin } from 'lib/store/adapter';
import { ipHash } from 'lib/store/security';
import { CheckinBodySchema } from 'lib/store/types';
import { assertSameOrigin, getClientIp, jsonError, jsonOk, rateLimit } from 'lib/server/security';

export const config = {
  api: {
    bodyParser: { sizeLimit: '32kb' },
  },
};

const WRITE_RATE_LIMIT = { keyPrefix: 'write:checkin', limit: 30, windowMs: 5 * 60_000 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });

    if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'ORIGIN_BLOCKED' });

    const rl = rateLimit(req, WRITE_RATE_LIMIT);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED' });
    }

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
    return jsonOk(res, { ok: false, error: 'internal_error', errorCode: 'INTERNAL_ERROR', lastError: message, device: null });
  }
}
