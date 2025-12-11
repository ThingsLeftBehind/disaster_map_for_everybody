import { randomUUID } from 'crypto';
import { serialize } from 'cookie';
import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from './prisma';
import { createTransferCode } from '@jp-evac/shared';

const DEVICE_COOKIE_NAME = 'jp-evac-device';

export function setDeviceCookie(res: NextApiResponse, hash: string) {
  const cookie = serialize(DEVICE_COOKIE_NAME, hash, {
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  res.setHeader('Set-Cookie', cookie);
}

export async function ensureDevice(req: NextApiRequest, res: NextApiResponse) {
  let hash = req.cookies[DEVICE_COOKIE_NAME];

  if (!hash) {
    hash = randomUUID();
    setDeviceCookie(res, hash);
  }

  const device = await prisma.device.upsert({
    where: { deviceHash: hash },
    update: {},
    create: {
      deviceHash: hash,
      transferCode: createTransferCode(),
    },
  });

  return device;
}
