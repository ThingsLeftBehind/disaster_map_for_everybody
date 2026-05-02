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

type NormalizedCheckinPayload = {
  deviceId: string;
  status: string;
  shelterId: string | null;
  lat: number;
  lon: number;
  locationAccuracyM: number | null;
  messagePublic: boolean;
  precision: 'COARSE' | 'PRECISE';
  comment: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickPresent(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function parseCoordinate(value: unknown, min: number, max: number): number | null {
  const num = toFiniteNumber(value);
  if (num === null) return null;
  if (num < min || num > max) return null;
  return num;
}

function coerceMessagePublic(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  }
  return false;
}

function normalizeSafetyStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/\s+/g, '');
  if (normalized === '無事' || normalized === 'safe' || normalized === 'ok') return 'safe';
  if (normalized === '負傷' || normalized === 'injured' || normalized === 'serious_injury' || normalized === 'serious-injury') return 'serious_injury';
  if (normalized === '孤立' || normalized === 'isolated') return 'isolated';
  if (normalized === '避難中' || normalized === 'evacuating') return 'evacuating';
  if (normalized === '避難完了' || normalized === '完了' || normalized === 'evacuated' || normalized === 'completed') return 'evacuated';
  if (normalized === 'injured') return 'serious_injury';
  return null;
}

function normalizePrecision(value: unknown): 'COARSE' | 'PRECISE' {
  if (typeof value === 'string' && value.trim().toUpperCase() === 'PRECISE') return 'PRECISE';
  return 'COARSE';
}

function normalizeComment(value: unknown): { ok: true; comment: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, comment: null };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, comment: null };
  if (trimmed.length > 140) return { ok: false };
  return { ok: true, comment: trimmed };
}

function normalizeCheckinPayload(rawBody: unknown): { ok: true; value: NormalizedCheckinPayload } | { ok: false; reason: string } {
  const parsed = CheckinBodySchema.safeParse(rawBody);
  if (parsed.success) {
    const comment = normalizeComment(parsed.data.comment);
    if (!comment.ok) return { ok: false, reason: 'comment_too_long' };
    return {
      ok: true,
      value: {
        deviceId: parsed.data.deviceId,
        status: normalizeSafetyStatus(parsed.data.status) ?? 'safe',
        shelterId: typeof parsed.data.shelterId === 'string' && parsed.data.shelterId.trim() ? parsed.data.shelterId.trim() : null,
        lat: parsed.data.lat,
        lon: parsed.data.lon,
        locationAccuracyM: parsed.data.locationAccuracyM ?? null,
        messagePublic: parsed.data.messagePublic ?? false,
        precision: normalizePrecision(parsed.data.precision),
        comment: comment.comment,
      },
    };
  }

  const body = asRecord(rawBody);
  if (!body) return { ok: false, reason: 'body_not_object' };
  const coords = asRecord(body.coords);

  const rawDeviceId = pickPresent(body.deviceId, body.deviceHash, body.device_hash);
  const deviceIdParsed = DeviceIdSchema.safeParse(rawDeviceId);
  if (!deviceIdParsed.success) return { ok: false, reason: 'device_id_invalid' };

  const rawStatus = pickPresent(body.status, body.safetyStatus, body.condition);
  const normalizedStatus = normalizeSafetyStatus(rawStatus);
  if (!normalizedStatus) return { ok: false, reason: 'status_invalid' };

  const lat = parseCoordinate(
    pickPresent(body.lat, body.latitude, body.lastKnownLat, body.last_known_lat, coords?.lat, coords?.latitude),
    -90,
    90
  );
  if (lat === null) return { ok: false, reason: 'lat_invalid' };

  const lon = parseCoordinate(
    pickPresent(body.lon, body.longitude, body.lastKnownLon, body.last_known_lon, coords?.lon, coords?.longitude),
    -180,
    180
  );
  if (lon === null) return { ok: false, reason: 'lon_invalid' };

  const rawAccuracy = pickPresent(body.locationAccuracyM, body.accuracy, body.locationAccuracy, coords?.accuracy);
  const parsedAccuracy = toFiniteNumber(rawAccuracy);
  const locationAccuracyM = parsedAccuracy !== null && parsedAccuracy >= 0 && parsedAccuracy <= 100_000 ? parsedAccuracy : null;

  const commentSource = pickPresent(body.message, body.comment);
  const comment = normalizeComment(commentSource);
  if (!comment.ok) return { ok: false, reason: 'comment_too_long' };

  const rawMessagePublic = pickPresent(body.messagePublic, body.isMessagePublic, body.publicMessage);
  const messagePublic = coerceMessagePublic(rawMessagePublic);

  const shelterIdRaw = pickPresent(body.shelterId, body.siteId);
  const shelterId = typeof shelterIdRaw === 'string' && shelterIdRaw.trim() ? shelterIdRaw.trim() : null;

  return {
    ok: true,
    value: {
      deviceId: deviceIdParsed.data,
      status: normalizedStatus,
      shelterId,
      lat,
      lon,
      locationAccuracyM,
      messagePublic,
      precision: normalizePrecision(body.precision),
      comment: comment.comment,
    },
  };
}

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
      return jsonOk(res, { ok: true, device });
    }

    if (req.method !== 'POST') return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });

    const normalized = normalizeCheckinPayload(req.body);
    if (!normalized.ok) {
      const body = asRecord(req.body);
      console.warn('[store:checkin] invalid_body', {
        reason: normalized.reason,
        keys: body ? Object.keys(body).slice(0, 20) : [],
      });
      return jsonError(res, 400, {
        ok: false,
        error: 'invalid_payload',
        errorCode: normalized.reason === 'comment_too_long' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_BODY',
      });
    }

    const ip = getClientIp(req);
    const result = await submitCheckinPin({
      deviceId: normalized.value.deviceId,
      ipHash: ipHash(ip),
      status: normalized.value.status,
      shelterId: normalized.value.shelterId,
      lat: normalized.value.lat,
      lon: normalized.value.lon,
      locationAccuracyM: normalized.value.locationAccuracyM,
      messagePublic: normalized.value.messagePublic,
      precision: normalized.value.precision,
      comment: normalized.value.comment,
    });
    if (!result.ok) {
      return jsonError(res, result.code === 'RATE_LIMITED' ? 429 : 400, {
        ok: false,
        error: result.message,
        code: result.code,
        errorCode: result.code,
      });
    }
    return jsonOk(res, { ok: true, device: result.value });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[store:checkin] unhandled_error', { error: message });
    return jsonError(res, 500, { ok: false, error: 'internal_error', errorCode: 'INTERNAL_ERROR', device: null });
  }
}
