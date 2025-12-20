import crypto from 'node:crypto';
import type { NextApiRequest } from 'next';

export function getClientIp(req: NextApiRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  if (Array.isArray(forwarded) && forwarded[0]) return forwarded[0];
  return req.socket.remoteAddress ?? 'unknown';
}

export function ipHash(ip: string): string {
  const salt = process.env.STORE_IP_SALT ?? 'dev-insecure-salt';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 24);
}

export function requireAdmin(req: NextApiRequest): { ok: true } | { ok: false; status: number; message: string } {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return { ok: false, status: 503, message: 'ADMIN_TOKEN is not set' };

  const auth = req.headers.authorization ?? '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, status: 401, message: 'Missing Authorization: Bearer <token>' };
  if (match[1] !== token) return { ok: false, status: 403, message: 'Invalid token' };
  return { ok: true };
}
