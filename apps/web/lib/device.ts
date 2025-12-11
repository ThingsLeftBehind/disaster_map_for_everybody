import { randomUUID } from 'crypto';
import { serialize } from 'cookie';
import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from './prisma';
import { createTransferCode } from '@jp-evac/shared';

const deviceCookie = 'device_hash';

function parseCookies(req: NextApiRequest) {
  const header = req.headers.cookie;
  if (!header) return {} as Record<string, string>;
  return Object.fromEntries(
    header.split(';').map((entry) => {
      const [key, ...rest] = entry.trim().split('=');
      return [decodeURIComponent(key), decodeURIComponent(rest.join('='))];
    })
  );
}

function setDeviceCookie(res: NextApiResponse, hash: string) {
  const cookie = serialize(deviceCookie, hash, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365
  });
  res.setHeader('Set-Cookie', cookie);
}

export function resolveDeviceHash(req: NextApiRequest) {
  const cookies = parseCookies(req);
  const headerHash = req.headers['x-device-hash'];
  if (typeof headerHash === 'string' && headerHash.trim()) return headerHash;
  if (Array.isArray(headerHash)) {
    const first = headerHash.find((v) => v.trim());
    if (first) return first;
  }
  if (cookies[deviceCookie]) return cookies[deviceCookie];
  return null;
}

export async function ensureDevice(req: NextApiRequest, res: NextApiResponse) {
  let hash = resolveDeviceHash(req);
  if (!hash) {
    hash = randomUUID();
    setDeviceCookie(res, hash);
  }
  let device = await prisma.device.findUnique({ where: { deviceHash: hash } });
  if (!device) {
    device = await prisma.device.create({ data: { deviceHash: hash, transferCode: createTransferCode() } });
  }
  return device;
}
