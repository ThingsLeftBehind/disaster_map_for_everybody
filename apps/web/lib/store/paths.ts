import fs from 'node:fs';
import path from 'node:path';
import { getWritableDataDir } from '../server/writable-data';

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

export function localStoreRootDir(): string {
  return path.join(getWritableDataDir(), 'local_store');
}

export function localStoreLocksDir(): string {
  return path.join(localStoreRootDir(), 'locks');
}

export function localStoreDevicesDir(): string {
  return path.join(localStoreRootDir(), 'devices');
}

export function localStoreSheltersDir(): string {
  return path.join(localStoreRootDir(), 'shelters');
}

export function localStoreAdminPath(): string {
  return path.join(localStoreRootDir(), 'admin.json');
}

export function localStoreModerationPath(): string {
  return path.join(localStoreRootDir(), 'moderation.json');
}

export function localStoreCheckinReportsPath(): string {
  return path.join(localStoreRootDir(), 'checkin_reports.json');
}

export function localStoreDevicePath(deviceId: string): string {
  const safe = deviceId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(localStoreDevicesDir(), `${safe}.json`);
}

export function localStoreShelterPath(shelterId: string): string {
  const safe = shelterId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(localStoreSheltersDir(), `${safe}.json`);
}

export function localStoreLockPath(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(localStoreLocksDir(), `${safe}.lock`);
}
