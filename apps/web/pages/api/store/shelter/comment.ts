import type { NextApiRequest, NextApiResponse } from 'next';
import { submitComment } from 'lib/store/adapter';
import { ipHash } from 'lib/store/security';
import { ShelterCommentBodySchema } from 'lib/store/types';
import { assertSameOrigin, getClientIp, jsonError, jsonOk, rateLimit } from 'lib/server/security';

export const config = {
  api: {
    bodyParser: { sizeLimit: '32kb' },
  },
};

const WRITE_RATE_LIMIT = { keyPrefix: 'write:shelter_comment', limit: 30, windowMs: 5 * 60_000 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });

    if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'ORIGIN_BLOCKED' });

    const rl = rateLimit(req, WRITE_RATE_LIMIT);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED' });
    }

    const parsed = ShelterCommentBodySchema.safeParse(req.body);
    if (!parsed.success) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY' });

    const text = parsed.data.text.trim();
    if (!text || text.length > 140) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY' });

    const ip = getClientIp(req);
    const result = await submitComment({
      shelterId: parsed.data.shelterId,
      deviceId: parsed.data.deviceId,
      ipHash: ipHash(ip),
      text,
    });
    if (!result.ok) {
      if (result.code === 'FORBIDDEN' && result.message === 'ACTIVE_POST_LIMIT_REACHED') {
        const details = (result.details ?? {}) as Record<string, unknown>;
        return jsonError(res, 409, {
          ok: false,
          error: 'active_post_limit_reached',
          errorCode: 'ACTIVE_POST_LIMIT_REACHED',
          activePostLimit: typeof details.activePostLimit === 'number' ? details.activePostLimit : 5,
          activePostCount: typeof details.activePostCount === 'number' ? details.activePostCount : 5,
          activePosts: Array.isArray(details.activePosts) ? details.activePosts : [],
        });
      }
      return jsonError(res, result.code === 'RATE_LIMITED' ? 429 : 400, {
        ok: false,
        error: result.message,
        code: result.code,
        errorCode: result.code,
      });
    }
    return jsonOk(res, { ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[store:shelter_comment] unhandled_error', { error: message });
    return jsonError(res, 500, { ok: false, error: 'internal_error', errorCode: 'INTERNAL_ERROR' });
  }
}
