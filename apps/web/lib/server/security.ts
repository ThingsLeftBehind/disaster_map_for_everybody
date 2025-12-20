import type { NextApiRequest, NextApiResponse } from 'next';

type RateLimitOptions = {
  keyPrefix: string;
  limit: number;
  windowMs: number;
};

type RateLimitResult = { ok: true; retryAfterSec: 0 } | { ok: false; retryAfterSec: number };

type RateLimitEntry = {
  timestamps: number[];
  windowMs: number;
  lastAccess: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();
const MAX_RATE_LIMIT_KEYS = 10_000;
let rateLimitCalls = 0;

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export function getClientIp(req: NextApiRequest): string {
  const forwarded = firstHeaderValue(req.headers['x-forwarded-for']);
  if (forwarded) return forwarded.split(',')[0].trim();
  const vercel = firstHeaderValue(req.headers['x-vercel-forwarded-for']);
  if (vercel) return vercel.split(',')[0].trim();
  const cf = firstHeaderValue(req.headers['cf-connecting-ip']);
  if (cf) return cf.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

export function assertSameOrigin(req: NextApiRequest): boolean {
  const originRaw = firstHeaderValue(req.headers.origin);
  if (!originRaw) return true;
  if (originRaw === 'null') return false;
  const hostHeader = firstHeaderValue(req.headers['x-forwarded-host']) ?? firstHeaderValue(req.headers.host);
  if (!hostHeader) return false;
  const host = hostHeader.split(',')[0].trim().toLowerCase();
  try {
    const originHost = new URL(originRaw).host.toLowerCase();
    if (originHost === host) return true;
    if (process.env.NODE_ENV !== 'production') {
      const normalizeLocal = (value: string) => value.replace('localhost', '127.0.0.1');
      const [originBase, originPort] = normalizeLocal(originHost).split(':');
      const [hostBase, hostPort] = normalizeLocal(host).split(':');
      const localHosts = new Set(['127.0.0.1', '0.0.0.0']);
      if (localHosts.has(originBase) && localHosts.has(hostBase) && originPort === hostPort) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function pruneRateLimitStore(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    const windowStart = now - entry.windowMs;
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
    if (entry.timestamps.length === 0 && now - entry.lastAccess > entry.windowMs) {
      rateLimitStore.delete(key);
    } else {
      rateLimitStore.set(key, entry);
    }
  }
  if (rateLimitStore.size <= MAX_RATE_LIMIT_KEYS) return;
  const entries = Array.from(rateLimitStore.entries()).sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  for (const [key] of entries) {
    rateLimitStore.delete(key);
    if (rateLimitStore.size <= MAX_RATE_LIMIT_KEYS) break;
  }
}

export function rateLimit(req: NextApiRequest, opts: RateLimitOptions): RateLimitResult {
  const ip = getClientIp(req);
  const key = `${opts.keyPrefix}:${ip}`;
  const now = Date.now();
  const windowStart = now - opts.windowMs;
  const entry = rateLimitStore.get(key) ?? { timestamps: [], windowMs: opts.windowMs, lastAccess: now };
  if (entry.windowMs !== opts.windowMs) entry.windowMs = opts.windowMs;
  entry.lastAccess = now;
  const recent = entry.timestamps.filter((t) => t > windowStart);
  if (recent.length >= opts.limit) {
    const oldest = Math.min(...recent);
    const retryAfterMs = oldest + opts.windowMs - now;
    const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
    entry.timestamps = recent;
    rateLimitStore.set(key, entry);
    return { ok: false, retryAfterSec };
  }
  recent.push(now);
  entry.timestamps = recent;
  rateLimitStore.set(key, entry);
  rateLimitCalls += 1;
  if (rateLimitCalls % 200 === 0 || rateLimitStore.size > MAX_RATE_LIMIT_KEYS) {
    pruneRateLimitStore();
  }
  return { ok: true, retryAfterSec: 0 };
}

export function requireAdmin(req: NextApiRequest, res?: NextApiResponse): boolean {
  const apiKey = process.env.ADMIN_API_KEY ?? '';
  const basicUser = process.env.ADMIN_BASIC_USER ?? '';
  const basicPass = process.env.ADMIN_BASIC_PASS ?? '';

  const keyHeader = firstHeaderValue(req.headers['x-admin-key']);
  const keyOk = Boolean(apiKey) && Boolean(keyHeader) && keyHeader === apiKey;

  const auth = firstHeaderValue(req.headers.authorization);
  let basicOk = false;
  if (basicUser && basicPass && auth && auth.toLowerCase().startsWith('basic ')) {
    const encoded = auth.slice(6).trim();
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      if (sep >= 0) {
        const user = decoded.slice(0, sep);
        const pass = decoded.slice(sep + 1);
        basicOk = user === basicUser && pass === basicPass;
      }
    } catch {
      basicOk = false;
    }
  }

  const hasAnySecret = Boolean(apiKey) || (Boolean(basicUser) && Boolean(basicPass));
  const ok = hasAnySecret && (keyOk || basicOk);
  if (ok) return true;

  if (res) jsonError(res, 401, { ok: false, error: 'unauthorized', errorCode: 'UNAUTHORIZED' });
  return false;
}

export function jsonOk(res: NextApiResponse, payload: Record<string, any>): void {
  res.status(200).json(payload);
}

export function jsonError(res: NextApiResponse, status: number, payload: Record<string, any>): void {
  res.status(status).json(payload);
}
