import type { NextApiRequest, NextApiResponse } from 'next';
import { reportCheckinPin } from 'lib/store/adapter';
import { CheckinReportBodySchema } from 'lib/store/types';
import { ipHash } from 'lib/store/security';
import { assertSameOrigin, getClientIp, jsonError, jsonOk, rateLimit } from 'lib/server/security';

export const config = {
  api: {
    bodyParser: { sizeLimit: '32kb' },
  },
};

const REPORT_RATE_LIMIT = { keyPrefix: 'report:checkin_pin', limit: 10, windowMs: 10 * 60_000 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });

    if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'ORIGIN_BLOCKED' });

    const rl = rateLimit(req, REPORT_RATE_LIMIT);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED' });
    }

    const parsed = CheckinReportBodySchema.safeParse(req.body);
    if (!parsed.success) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY' });

    const reason = typeof parsed.data.reason === 'string' ? parsed.data.reason.trim() : null;
    if (reason && reason.length > 200) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY' });

    const ip = getClientIp(req);
    const result = await reportCheckinPin({
      pinId: parsed.data.pinId,
      deviceId: parsed.data.deviceId,
      ipHash: ipHash(ip),
      reason: reason || null,
    });
    if (!result.ok) {
      return jsonError(res, result.code === 'RATE_LIMITED' ? 429 : 400, {
        ok: false,
        error: result.message,
        code: result.code,
        errorCode: result.code,
      });
    }
    return jsonOk(res, { ok: true, value: result.value });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonOk(res, { ok: false, error: 'internal_error', errorCode: 'INTERNAL_ERROR', lastError: message, value: null });
  }
}
