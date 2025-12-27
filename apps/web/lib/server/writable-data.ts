import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cachedWritableDir: string | null = null;

export function getWritableDataDir(): string {
  if (cachedWritableDir) return cachedWritableDir;
  const isServerless = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION);
  const baseDir = isServerless ? path.join(os.tmpdir(), 'hinanavi') : path.join(process.cwd(), 'data');
  try {
    fs.mkdirSync(baseDir, { recursive: true });
  } catch {
    // Best effort; callers should handle missing directories when writing.
  }
  cachedWritableDir = baseDir;
  return cachedWritableDir;
}
