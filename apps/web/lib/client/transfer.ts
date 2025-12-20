function base64UrlEncode(input: string): string {
  const b64 = btoa(unescape(encodeURIComponent(input)));
  return b64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlDecode(input: string): string {
  const padded = input.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  return decodeURIComponent(escape(atob(padded)));
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function encodeTransferCode(payload: unknown): Promise<string> {
  const json = JSON.stringify(payload);
  const b64 = base64UrlEncode(json);
  const sum = (await sha256Hex(b64)).slice(0, 10);
  return `${b64}.${sum}`;
}

export async function decodeTransferCode(code: string): Promise<{ ok: true; payload: any } | { ok: false; message: string }> {
  const parts = code.trim().split('.');
  if (parts.length !== 2) return { ok: false, message: 'Invalid code format' };
  const [b64, sum] = parts;
  const expected = (await sha256Hex(b64)).slice(0, 10);
  if (expected !== sum) return { ok: false, message: 'Checksum mismatch' };
  try {
    const json = base64UrlDecode(b64);
    const payload = JSON.parse(json);
    return { ok: true, payload };
  } catch {
    return { ok: false, message: 'Invalid payload' };
  }
}

