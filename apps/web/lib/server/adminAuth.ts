import crypto from 'node:crypto';
import type { NextApiRequest } from 'next';

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

export function resolveBearerSecret(req: NextApiRequest): string {
  const authorization = firstHeader(req.headers.authorization).trim();
  if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, '').trim();
  return firstHeader(req.headers['x-cleanup-secret']).trim();
}

export function isAuthorizedAdminSecret(req: NextApiRequest): boolean {
  const provided = resolveBearerSecret(req);
  if (!provided) return false;
  const candidates = [process.env.CLEANUP_SECRET, process.env.CRON_SECRET]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return candidates.some((secret) => safeEqual(secret, provided));
}

