import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { STORE_LOCK_TTL_MS } from './config';
import { ensureDirForFile, isErrnoException } from './fs';
import { localStoreLockPath } from './paths';

const inProcess = new Map<string, Promise<unknown>>();

async function tryAcquireLock(lockPath: string, ttlMs: number): Promise<FileHandle | null> {
  await ensureDirForFile(lockPath);
  try {
    return await fs.open(lockPath, 'wx');
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'EEXIST') throw error;

    const stat = await fs.stat(lockPath).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > ttlMs) {
      await fs.unlink(lockPath).catch(() => null);
      try {
        return await fs.open(lockPath, 'wx');
      } catch (secondError) {
        if (!isErrnoException(secondError) || secondError.code !== 'EEXIST') throw secondError;
      }
    }
    return null;
  }
}

export async function runExclusive<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs: number = STORE_LOCK_TTL_MS
): Promise<{ executed: boolean; value: T | null }> {
  const existing = inProcess.get(key);
  if (existing) {
    await existing.catch(() => null);
    return { executed: false, value: null };
  }

  const lockPath = localStoreLockPath(key);
  const handle = await tryAcquireLock(lockPath, ttlMs);
  if (!handle) return { executed: false, value: null };

  await handle
    .writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8')
    .catch(() => null);
  await handle.close();

  const promise = (async () => {
    try {
      const value = await fn();
      return value;
    } finally {
      await fs.unlink(lockPath).catch(() => null);
      inProcess.delete(key);
    }
  })();

  inProcess.set(key, promise);
  const value = await promise;
  return { executed: true, value };
}

