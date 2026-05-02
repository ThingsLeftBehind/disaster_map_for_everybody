import crypto from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { runCleanup } from 'lib/server/cleanup';
import { jsonError, jsonOk, rateLimit } from 'lib/server/security';

const CLEANUP_RATE_LIMIT = { keyPrefix: 'admin:cleanup', limit: 20, windowMs: 10 * 60_000 };

function firstHeader(value: string | string[] | undefined): string {
  if (!value) return '';
  return Array.isArray(value) ? value[0] ?? '' : value;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function resolveProvidedSecret(req: NextApiRequest): string {
  const authorization = firstHeader(req.headers.authorization).trim();
  if (/^bearer\s+/i.test(authorization)) {
    return authorization.replace(/^bearer\s+/i, '').trim();
  }
  return firstHeader(req.headers['x-cleanup-secret']).trim();
}

function toBooleanLike(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  }
  return null;
}

function parseDryRun(req: NextApiRequest): boolean {
  const queryDryRunRaw = Array.isArray(req.query.dryRun) ? req.query.dryRun[0] : req.query.dryRun;
  const queryDryRun = toBooleanLike(queryDryRunRaw);

  let bodyDryRun: boolean | null = null;
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    bodyDryRun = toBooleanLike((req.body as { dryRun?: unknown }).dryRun);
  }

  const resolved = queryDryRun ?? bodyDryRun;
  if (resolved === null) return true;
  return resolved;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });
  }

  const rl = rateLimit(req, CLEANUP_RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED' });
  }

  const configuredSecret = (process.env.CLEANUP_SECRET ?? '').trim();
  if (!configuredSecret) {
    return jsonError(res, 500, {
      ok: false,
      error: 'cleanup_not_configured',
      errorCode: 'CLEANUP_NOT_CONFIGURED',
    });
  }

  const providedSecret = resolveProvidedSecret(req);
  if (!providedSecret || !safeEqual(configuredSecret, providedSecret)) {
    return jsonError(res, 401, { ok: false, error: 'unauthorized', errorCode: 'UNAUTHORIZED' });
  }

  const dryRun = parseDryRun(req);

  try {
    const result = await runCleanup({ dryRun });
    return jsonOk(res, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[admin:cleanup] failed', { error: message, dryRun });
    return jsonError(res, 500, {
      ok: false,
      dryRun,
      deletedSafetyStatusCount: 0,
      deletedSiteStatusReportCount: 0,
      cutoffs: null,
      errors: ['cleanup_failed'],
      error: 'internal_error',
      errorCode: 'INTERNAL_ERROR',
    });
  }
}
