import type { NextApiRequest, NextApiResponse } from 'next';
import { exportTransferCode } from 'lib/store/adapter';
import { TransferExportBodySchema } from 'lib/store/types';
import { assertSameOrigin, jsonError, jsonOk, rateLimit } from 'lib/server/security';

export const config = {
  api: {
    bodyParser: { sizeLimit: '32kb' },
  },
};

const WRITE_RATE_LIMIT = { keyPrefix: 'write:transfer_export', limit: 30, windowMs: 5 * 60_000 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });

  if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'ORIGIN_BLOCKED' });

  const rl = rateLimit(req, WRITE_RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED' });
  }

  const parsed = TransferExportBodySchema.safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY' });

  const result = await exportTransferCode(parsed.data.deviceId);
  if (!result.ok) return jsonError(res, 400, { ok: false, error: result.message, code: result.code, errorCode: result.code });
  return jsonOk(res, result.value);
}
