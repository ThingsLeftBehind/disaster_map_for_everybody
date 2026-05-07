import type { NextApiRequest, NextApiResponse } from 'next';
import { DeviceIdSchema } from 'lib/store/types';
import { assertSameOrigin, jsonError, jsonOk, rateLimit } from 'lib/server/security';
import { deleteWatchRegion, updateWatchRegion, WatchRegionApiError } from 'lib/server/watchRegions';

export const config = {
  api: {
    bodyParser: { sizeLimit: '32kb' },
  },
};

const WRITE_RATE_LIMIT = { keyPrefix: 'write:watch-region', limit: 40, windowMs: 5 * 60_000 };

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

function safeApiError(res: NextApiResponse, error: unknown): void {
  if (error instanceof WatchRegionApiError) {
    jsonError(res, error.status, { ok: false, error: error.message, errorCode: error.errorCode });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.warn('[watch-region] unhandled_error', { error: message });
  jsonError(res, 500, { ok: false, error: 'internal_error', errorCode: 'internal_error' });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (!assertSameOrigin(req)) return jsonError(res, 403, { ok: false, error: 'forbidden', errorCode: 'forbidden' });

  try {
    if (req.method !== 'PATCH' && req.method !== 'DELETE') {
      return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'method_not_allowed' });
    }

    const rl = rateLimit(req, WRITE_RATE_LIMIT);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'rate_limited' });
    }

    const id = first(req.query.id);
    if (!id) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'invalid_payload' });

    const deviceId = parseDeviceId(req);
    if (!deviceId) return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'invalid_payload' });

    if (req.method === 'PATCH') {
      const region = await updateWatchRegion(deviceId, id, req.body);
      if (!region) return jsonError(res, 404, { ok: false, error: 'not_found', errorCode: 'not_found' });
      return jsonOk(res, { ok: true, region });
    }

    const deleted = await deleteWatchRegion(deviceId, id);
    if (!deleted) return jsonError(res, 404, { ok: false, error: 'not_found', errorCode: 'not_found' });
    return jsonOk(res, { ok: true });
  } catch (error) {
    return safeApiError(res, error);
  }
}
