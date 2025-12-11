import crypto from 'crypto';

export function createDeviceHash(seed?: string) {
  const value = seed ?? crypto.randomUUID();
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function createTransferCode() {
  const base = crypto.randomBytes(6).toString('hex');
  return base.slice(0, 12);
}
