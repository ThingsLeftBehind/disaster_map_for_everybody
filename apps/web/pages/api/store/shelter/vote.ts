import type { NextApiRequest, NextApiResponse } from 'next';
import { deleteShelterVoteAndComment, submitVote } from 'lib/store/adapter';
import { ipHash } from 'lib/store/security';
import { ShelterVoteBodySchema } from 'lib/store/types';
import { assertSameOrigin, getClientIp, jsonError, jsonOk, rateLimit } from 'lib/server/security';

export const config = {
  api: {
    bodyParser: { sizeLimit: '32kb' },
  },
};

const WRITE_RATE_LIMIT = { keyPrefix: 'write:shelter_vote', limit: 30, windowMs: 5 * 60_000 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'DELETE') {
    if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'ORIGIN_BLOCKED' });

    // We reuse ShelterVoteBodySchema for validation of shelterId/deviceId, 
    // but we don't need 'value' field. Or we can just read query/body manually.
    // Let's assume the client sends { shelterId, deviceId } in body for DELETE too.
    const parsed = ShelterVoteBodySchema.omit({ value: true }).safeParse(req.body);
    if (!parsed.success) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY' });

    const result = await deleteShelterVoteAndComment({
      shelterId: parsed.data.shelterId,
      deviceId: parsed.data.deviceId,
    });

    if (!result.ok) {
      return jsonError(res, 400, { ok: false, error: result.message, errorCode: result.code });
    }
    return jsonOk(res, { ok: true });
  }

  if (req.method !== 'POST') return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });

  if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'ORIGIN_BLOCKED' });

  const rl = rateLimit(req, WRITE_RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED' });
  }

  const parsed = ShelterVoteBodySchema.safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY' });

  const ip = getClientIp(req);
  const result = await submitVote({
    shelterId: parsed.data.shelterId,
    deviceId: parsed.data.deviceId,
    ipHash: ipHash(ip),
    value: parsed.data.value,
  });

  if (!result.ok) {
    return jsonError(res, result.code === 'RATE_LIMITED' ? 429 : 400, {
      ok: false,
      error: result.message,
      code: result.code,
      errorCode: result.code,
    });
  }
  return jsonOk(res, { ok: true });
}
