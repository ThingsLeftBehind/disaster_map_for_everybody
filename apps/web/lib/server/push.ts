import crypto from 'node:crypto';
import { prisma } from 'lib/db/prisma';

export type PushSubscriptionInput = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

type DeviceRef = { id: string; deviceHash: string };

function base64urlToBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64');
}

function bufferToBase64url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getVapidConfig() {
  const publicKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY ?? '').trim();
  const subject = (process.env.VAPID_SUBJECT ?? '').trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export function getVapidPublicKey(): string | null {
  return (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '').trim() || null;
}

export function validateSubscription(raw: unknown): PushSubscriptionInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
  const keys = body.keys && typeof body.keys === 'object' && !Array.isArray(body.keys) ? (body.keys as Record<string, unknown>) : {};
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : '';
  const auth = typeof keys.auth === 'string' ? keys.auth.trim() : '';
  if (!/^https:\/\/.+/i.test(endpoint) || p256dh.length < 40 || auth.length < 10) return null;
  return { endpoint, keys: { p256dh, auth } };
}

async function findDeviceByHash(deviceHash: string): Promise<DeviceRef | null> {
  return prisma.device.findUnique({ where: { deviceHash }, select: { id: true, deviceHash: true } });
}

export async function resolveOrCreateDevice(deviceHash: string): Promise<DeviceRef> {
  const existing = await findDeviceByHash(deviceHash.trim());
  if (existing) return existing;
  const now = new Date();
  try {
    return await prisma.device.create({
      data: {
        id: crypto.randomUUID(),
        deviceHash: deviceHash.trim(),
        transferCode: crypto.randomUUID(),
        updatedAt: now,
      },
      select: { id: true, deviceHash: true },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Unique constraint failed/i.test(message)) throw error;
    const raced = await findDeviceByHash(deviceHash.trim());
    if (!raced) throw error;
    return raced;
  }
}

export async function getDeviceByHash(deviceHash: string): Promise<DeviceRef | null> {
  return findDeviceByHash(deviceHash.trim());
}

export async function upsertPushSubscription(args: {
  deviceHash: string;
  subscription: PushSubscriptionInput;
  userAgent?: string | null;
}) {
  const device = await resolveOrCreateDevice(args.deviceHash);
  await prisma.pushSubscription.upsert({
    where: { endpoint: args.subscription.endpoint },
    create: {
      deviceId: device.id,
      endpoint: args.subscription.endpoint,
      p256dh: args.subscription.keys.p256dh,
      auth: args.subscription.keys.auth,
      userAgent: args.userAgent ?? null,
      disabledAt: null,
    },
    update: {
      deviceId: device.id,
      p256dh: args.subscription.keys.p256dh,
      auth: args.subscription.keys.auth,
      userAgent: args.userAgent ?? null,
      disabledAt: null,
      updatedAt: new Date(),
    },
  });
}

export async function disablePushSubscription(args: { deviceHash: string; endpoint?: string | null }): Promise<number> {
  const device = await getDeviceByHash(args.deviceHash);
  if (!device) return 0;
  const result = await prisma.pushSubscription.updateMany({
    where: {
      deviceId: device.id,
      disabledAt: null,
      ...(args.endpoint ? { endpoint: args.endpoint } : {}),
    },
    data: { disabledAt: new Date(), updatedAt: new Date() },
  });
  return result.count;
}

export async function getPushSubscriptionStatus(deviceHash: string): Promise<{ enabled: boolean; count: number }> {
  const device = await getDeviceByHash(deviceHash);
  if (!device) return { enabled: false, count: 0 };
  const count = await prisma.pushSubscription.count({ where: { deviceId: device.id, disabledAt: null } });
  return { enabled: count > 0, count };
}

function createVapidJwt(endpoint: string): string {
  const config = getVapidConfig();
  if (!config) throw new Error('vapid_not_configured');
  const publicBytes = base64urlToBuffer(config.publicKey);
  const privateBytes = base64urlToBuffer(config.privateKey);
  const key = crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: bufferToBase64url(publicBytes.subarray(1, 33)),
      y: bufferToBase64url(publicBytes.subarray(33, 65)),
      d: bufferToBase64url(privateBytes),
    },
    format: 'jwk',
  });
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const header = bufferToBase64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bufferToBase64url(Buffer.from(JSON.stringify({ aud, exp, sub: config.subject })));
  const input = `${header}.${claims}`;
  const signature = crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${bufferToBase64url(signature)}`;
}

function hkdfExpand(prk: Buffer, info: Buffer | string, length: number): Buffer {
  const infoBuffer = Buffer.isBuffer(info) ? info : Buffer.from(info);
  const blocks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  let counter = 1;
  while (Buffer.concat(blocks).length < length) {
    previous = crypto
      .createHmac('sha256', prk)
      .update(Buffer.concat([previous, infoBuffer, Buffer.from([counter])]))
      .digest();
    blocks.push(previous);
    counter += 1;
  }
  return Buffer.concat(blocks).subarray(0, length);
}

function encryptPushPayload(subscription: PushSubscriptionInput, payload: PushPayload): Buffer {
  const receiverPublicKey = base64urlToBuffer(subscription.keys.p256dh);
  const authSecret = base64urlToBuffer(subscription.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  const senderPublicKey = ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(receiverPublicKey);
  const salt = crypto.randomBytes(16);

  const prkKey = crypto.createHmac('sha256', authSecret).update(sharedSecret).digest();
  const ikm = hkdfExpand(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), receiverPublicKey, senderPublicKey]), 32);
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  const cek = hkdfExpand(prk, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = hkdfExpand(prk, 'Content-Encoding: nonce\0', 12);

  const plaintext = Buffer.concat([Buffer.from(JSON.stringify(payload)), Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  return Buffer.concat([salt, rs, Buffer.from([senderPublicKey.length]), senderPublicKey, ciphertext]);
}

export async function sendWebPush(subscription: PushSubscriptionInput, payload: PushPayload): Promise<{ ok: true } | { ok: false; status: number }> {
  const config = getVapidConfig();
  if (!config) throw new Error('vapid_not_configured');
  const jwt = createVapidJwt(subscription.endpoint);
  const body = encryptPushPayload(subscription, payload);
  const arrayBuffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      authorization: `vapid t=${jwt}, k=${config.publicKey}`,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '3600',
      urgency: 'normal',
    },
    body: arrayBuffer,
  });
  return res.ok ? { ok: true } : { ok: false, status: res.status };
}
