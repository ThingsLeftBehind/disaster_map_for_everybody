import type { NextApiRequest, NextApiResponse } from 'next';
import { getModerationState, moderationAction } from 'lib/store/adapter';
import { AdminModerationActionBodySchema } from 'lib/store/types';
import { assertSameOrigin, jsonError, jsonOk, rateLimit, requireAdmin } from 'lib/server/security';

export const config = {
  api: {
    bodyParser: { sizeLimit: '32kb' },
  },
};

const ADMIN_RATE_LIMIT = { keyPrefix: 'admin:moderation', limit: 60, windowMs: 10 * 60_000 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });
    }

    const rl = rateLimit(req, ADMIN_RATE_LIMIT);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED' });
    }

    if (req.method === 'POST' && !assertSameOrigin(req)) {
      return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'ORIGIN_BLOCKED' });
    }

    if (!requireAdmin(req, res)) return;

    if (req.method === 'GET') {
      const moderation = await getModerationState();
      return jsonOk(res, { moderation });
    }

    if (req.method === 'POST') {
      const parsed = AdminModerationActionBodySchema.safeParse(req.body);
      if (!parsed.success) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY' });

      const result = await moderationAction({
        action: parsed.data.action,
        shelterId: parsed.data.shelterId,
        commentId: parsed.data.commentId,
      });
      if (!result.ok) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY' });
      return jsonOk(res, { ok: true });
    }

    return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonOk(res, { ok: false, error: 'internal_error', errorCode: 'INTERNAL_ERROR', lastError: message });
  }
}
