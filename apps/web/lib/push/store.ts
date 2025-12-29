import path from 'node:path';
import { atomicWriteJson, ensureDirForFile, readJsonFile } from 'lib/store/fs';
import { runExclusive } from 'lib/store/lock';
import { localStoreRootDir } from 'lib/store/paths';
import type { PushRegisterBody } from './types';

export type PushDeviceRecord = {
  deviceId: string;
  expoPushToken: string;
  subscribedCells: Array<{
    cellId: string;
    prefCode: string | null;
    lastSeenAt: string;
  }>;
  platform?: string;
  appVersion?: string;
  locale?: string;
  timezoneOffsetMinutes?: number;
  updatedAt: string;
  lastNotified: Record<string, { level: string; sentAt: string }>;
};

type PushStore = {
  updatedAt: string | null;
  devices: PushDeviceRecord[];
};

const STORE_PATH = path.join(localStoreRootDir(), 'push', 'devices.json');

function nowIso(): string {
  return new Date().toISOString();
}

function defaultStore(): PushStore {
  return { updatedAt: null, devices: [] };
}

async function readStore(): Promise<PushStore> {
  const raw = await readJsonFile<PushStore>(STORE_PATH);
  if (!raw || !Array.isArray(raw.devices)) return defaultStore();
  return { updatedAt: raw.updatedAt ?? null, devices: raw.devices };
}

async function writeStore(store: PushStore): Promise<void> {
  await ensureDirForFile(STORE_PATH);
  await atomicWriteJson(STORE_PATH, store);
}

export async function updatePushStore(mutator: (store: PushStore) => PushStore): Promise<PushStore> {
  const { value } = await runExclusive('push-store', async () => {
    const current = await readStore();
    const next = mutator(current);
    await writeStore(next);
    return next;
  });
  return value ?? readStore();
}

export async function upsertPushDevice(body: PushRegisterBody): Promise<PushDeviceRecord> {
  const now = nowIso();
  const cells = dedupeCells(body.subscribedCells, now);
  const device = await updatePushStore((store) => {
    const existing = store.devices.find((d) => d.deviceId === body.deviceId) ?? null;
    const nextDevice: PushDeviceRecord = {
      deviceId: body.deviceId,
      expoPushToken: body.expoPushToken,
      subscribedCells: cells,
      platform: body.platform,
      appVersion: body.appVersion,
      locale: body.locale,
      timezoneOffsetMinutes: body.timezoneOffsetMinutes,
      updatedAt: now,
      lastNotified: existing?.lastNotified ?? {},
    };

    const filtered = store.devices.filter(
      (d) => d.deviceId !== body.deviceId && d.expoPushToken !== body.expoPushToken
    );
    const devices = [nextDevice, ...filtered];
    return { updatedAt: now, devices };
  });

  return device.devices.find((d) => d.deviceId === body.deviceId)!;
}

export async function removePushDevice(deviceId: string): Promise<void> {
  await updatePushStore((store) => ({
    updatedAt: nowIso(),
    devices: store.devices.filter((d) => d.deviceId !== deviceId),
  }));
}

export async function listPushDevices(): Promise<PushDeviceRecord[]> {
  const store = await readStore();
  return store.devices;
}

export async function updatePushDeviceNotified(
  deviceId: string,
  lastNotified: Record<string, { level: string; sentAt: string }>
): Promise<void> {
  await updatePushStore((store) => {
    const devices = store.devices.map((device) =>
      device.deviceId === deviceId ? { ...device, lastNotified } : device
    );
    return { updatedAt: nowIso(), devices };
  });
}

export async function removeInvalidTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  const drop = new Set(tokens);
  await updatePushStore((store) => ({
    updatedAt: nowIso(),
    devices: store.devices.filter((device) => !drop.has(device.expoPushToken)),
  }));
}

function dedupeCells(
  cells: Array<{ cellId: string; prefCode?: string | null; lastSeenAt?: string }>,
  now: string
): Array<{ cellId: string; prefCode: string | null; lastSeenAt: string }> {
  const map = new Map<string, { cellId: string; prefCode: string | null; lastSeenAt: string }>();
  for (const cell of cells) {
    const cellId = String(cell.cellId);
    if (!cellId) continue;
    const prev = map.get(cellId);
    const lastSeenAt = cell.lastSeenAt ?? prev?.lastSeenAt ?? now;
    map.set(cellId, {
      cellId,
      prefCode: cell.prefCode ?? prev?.prefCode ?? null,
      lastSeenAt,
    });
  }
  return Array.from(map.values())
    .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1))
    .slice(0, 12);
}
