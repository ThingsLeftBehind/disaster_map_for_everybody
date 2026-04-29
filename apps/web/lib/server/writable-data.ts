import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cachedWritableDir: string | null = null;
let cachedRepoRoot: string | null = null;

function getRepoRootDir(): string {
  if (cachedRepoRoot) return cachedRepoRoot;

  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const hasMarkers =
      fs.existsSync(path.join(dir, 'package.json')) &&
      fs.existsSync(path.join(dir, 'apps')) &&
      fs.existsSync(path.join(dir, 'packages')) &&
      fs.existsSync(path.join(dir, 'data'));
    if (hasMarkers) {
      cachedRepoRoot = dir;
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  cachedRepoRoot = process.cwd();
  return cachedRepoRoot;
}

export function getWritableDataDir(): string {
  if (cachedWritableDir) return cachedWritableDir;
  const isServerless = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION);
  const baseDir = isServerless ? path.join(os.tmpdir(), 'hinanavi') : path.join(getRepoRootDir(), 'data');
  try {
    fs.mkdirSync(baseDir, { recursive: true });
  } catch {
    // Best effort; callers should handle missing directories when writing.
  }
  cachedWritableDir = baseDir;
  return cachedWritableDir;
}
