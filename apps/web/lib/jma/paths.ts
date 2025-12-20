import fs from 'node:fs';
import path from 'node:path';
import type { JmaFeedKey } from './types';

let cachedRepoRoot: string | null = null;

export function getRepoRootDir(): string {
  if (cachedRepoRoot) return cachedRepoRoot;

  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
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

export function jmaCacheRootDir(): string {
  return path.join(getRepoRootDir(), 'data', 'cache', 'jma');
}

export function jmaFeedsDir(): string {
  return path.join(jmaCacheRootDir(), 'feeds');
}

export function jmaEntriesDir(): string {
  return path.join(jmaCacheRootDir(), 'entries');
}

export function jmaNormalizedDir(): string {
  return path.join(jmaCacheRootDir(), 'normalized');
}

export function jmaWebJsonDir(): string {
  return path.join(jmaCacheRootDir(), 'webjson');
}

export function jmaLocksDir(): string {
  return path.join(jmaCacheRootDir(), 'locks');
}

export function jmaStateFilePath(): string {
  return path.join(jmaCacheRootDir(), 'state.json');
}

export function jmaFeedXmlPath(feed: JmaFeedKey): string {
  return path.join(jmaFeedsDir(), `${feed}.xml`);
}

export function jmaEntryXmlPath(entryHash: string): string {
  return path.join(jmaEntriesDir(), `${entryHash}.xml`);
}

export function jmaNormalizedQuakesPath(): string {
  return path.join(jmaNormalizedDir(), 'quakes.json');
}

export function jmaNormalizedWarningsPath(): string {
  return path.join(jmaNormalizedDir(), 'warnings.json');
}

export function jmaNormalizedStatusPath(): string {
  return path.join(jmaNormalizedDir(), 'status.json');
}

export function jmaWebJsonQuakeListPath(): string {
  return path.join(jmaWebJsonDir(), 'quake_list.json');
}

export function jmaWebJsonWarningPath(area: string): string {
  return path.join(jmaWebJsonDir(), `warning_${area}.json`);
}

export function jmaLockFilePath(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(jmaLocksDir(), `${safe}.lock`);
}

export function jmaAreaConstPath(): string {
  return path.join(getRepoRootDir(), 'data', 'ref', 'jma', 'const', 'area.json');
}

