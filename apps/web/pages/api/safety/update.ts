import type { NextApiRequest, NextApiResponse } from 'next';
import { SafetyUpdateSchema } from 'lib/validators';
import { appendCheckin, updateDeviceState } from 'lib/store/adapter';
import { assertSameOrigin, jsonError, jsonOk, rateLimit } from 'lib/server/security';

export const config = {
  api: {
    bodyParser: { sizeLimit: '32kb' },
  },
};

const WRITE_RATE_LIMIT = { keyPrefix: 'write:safety_update', limit: 30, windowMs: 5 * 60_000 };

function isTooLarge(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 50;
  if (typeof value === 'string') return value.length > 2000;
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 50;
  return false;
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

  const parsed = SafetyUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'INVALID_BODY' });
  }

  const { device_hash, status, last_known_lat, last_known_lon, saved_places, hazard_alert_prefs } = parsed.data;
  if (isTooLarge(saved_places) || isTooLarge(hazard_alert_prefs)) {
    return jsonError(res, 400, { ok: false, error: 'invalid_payload', errorCode: 'PAYLOAD_TOO_LARGE' });
  }

  const deviceId = device_hash;
  await updateDeviceState(deviceId, {
    settings: {
      // Keep legacy fields out of server store to avoid storing precise GPS by default.
      // The UI stores location locally; we accept this endpoint for backward compatibility only.
    },
  });

  const mapped =
    status === 'EVACUATED'
      ? 'COMPLETED'
      : status === 'SAFE'
        ? 'SAFE'
        : status === 'EVACUATING'
          ? 'EVACUATING'
          : status === 'INJURED'
            ? 'INJURED'
            : status === 'ISOLATED'
              ? 'ISOLATED'
              : 'SAFE';

  const device = await appendCheckin(deviceId, { status: mapped, shelterId: null });
  return jsonOk(res, { device, legacy: { last_known_lat, last_known_lon, saved_places, hazard_alert_prefs } });
}
