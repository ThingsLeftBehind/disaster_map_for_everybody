import crypto from 'node:crypto';

function base64UrlEncode(input) {
  return Buffer.from(input, 'utf8').toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlDecode(input) {
  const padded = input.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function checksum(payloadB64) {
  return crypto.createHash('sha256').update(payloadB64).digest('hex').slice(0, 10);
}

export function encodeTransferCode(payload) {
  const json = JSON.stringify(payload);
  const b64 = base64UrlEncode(json);
  return `${b64}.${checksum(b64)}`;
}

export function decodeTransferCode(code) {
  const parts = code.split('.');
  if (parts.length !== 2) return { ok: false, message: 'Invalid code format' };
  const [b64, sum] = parts;
  if (checksum(b64) !== sum) return { ok: false, message: 'Checksum mismatch' };
  try {
    const json = base64UrlDecode(b64);
    const payload = JSON.parse(json);
    return { ok: true, payload };
  } catch {
    return { ok: false, message: 'Invalid payload' };
  }
}

