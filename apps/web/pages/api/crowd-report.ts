import type { NextApiRequest, NextApiResponse } from 'next';
import { CrowdReportSchema } from 'lib/validators';
import { submitComment, submitVote } from 'lib/store/adapter';
import { ipHash } from 'lib/store/security';
import { assertSameOrigin, getClientIp, jsonError, jsonOk, rateLimit } from 'lib/server/security';

export const config = {
  api: {
    bodyParser: { sizeLimit: '32kb' },
  },
};

const WRITE_RATE_LIMIT = { keyPrefix: 'write:crowd_report', limit: 30, windowMs: 5 * 60_000 };

function mapLegacyStatus(status: string) {
  switch (status) {
    case 'OK':
      return 'NORMAL';
    case 'CROWDED':
      return 'CROWDED';
    case 'VERY_CROWDED':
      return 'CROWDED';
    case 'CLOSED':
      return 'CLOSED';
    case 'BLOCKED':
      return 'CLOSED';
    default:
      return 'NORMAL';
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });
  }

  if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'ORIGIN_BLOCKED' });

  const rl = rateLimit(req, WRITE_RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED' });
  }

  const parsed = CrowdReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY' });
  }

  const { siteId, status, comment, device_hash } = parsed.data;
  const trimmedComment = typeof comment === 'string' ? comment.trim() : '';
  if (trimmedComment && trimmedComment.length > 300) {
    return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY' });
  }

  const ip = getClientIp(req);
  const deviceId = device_hash;
  const value = mapLegacyStatus(status);

  const voteResult = await submitVote({
    shelterId: siteId,
    deviceId,
    ipHash: ipHash(ip),
    value: value as any,
  });
  if (!voteResult.ok) {
    return jsonError(res, voteResult.code === 'RATE_LIMITED' ? 429 : 400, {
      ok: false,
      error: voteResult.message,
      code: voteResult.code,
      errorCode: voteResult.code,
    });
  }

  if (trimmedComment) {
    const commentResult = await submitComment({
      shelterId: siteId,
      deviceId,
      ipHash: ipHash(ip),
      text: trimmedComment,
    });
    if (!commentResult.ok) {
      return jsonError(res, commentResult.code === 'RATE_LIMITED' ? 429 : 400, {
        ok: false,
        error: commentResult.message,
        code: commentResult.code,
        errorCode: commentResult.code,
      });
    }
  }

  return jsonOk(res, { ok: true });
}
