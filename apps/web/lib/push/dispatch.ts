import { getJmaQuakes, getJmaWarnings } from 'lib/jma/service';
import { isJmaLowPriorityWarning } from 'lib/jma/filters';
import type { NormalizedWarningItem } from 'lib/jma/types';
import type { ExpoPushMessage } from './expo';
import type { PushDeviceRecord } from './store';

const MAX_PUSH_PER_DEVICE = 3;
const DEDUPE_WINDOW_MS = 12 * 60 * 60_000;

type DeviceUpdate = {
  deviceId: string;
  lastNotified: Record<string, { level: string; sentAt: string }>;
};

type PushWorkItem = {
  deviceId: string;
  message: ExpoPushMessage;
};

export async function buildPushMessages(devices: PushDeviceRecord[]): Promise<{
  messages: PushWorkItem[];
  updates: DeviceUpdate[];
  areaCodes: string[];
}> {
  const areaCodes = collectAreaCodes(devices);
  const warningsByArea = new Map<string, Awaited<ReturnType<typeof getJmaWarnings>>>();

  for (const area of areaCodes) {
    try {
      warningsByArea.set(area, await getJmaWarnings(area));
    } catch {
      warningsByArea.set(area, {
        fetchStatus: 'DEGRADED',
        updatedAt: null,
        lastError: 'Failed to load warnings',
        area,
        areaName: null,
        confidence: 'LOW',
        confidenceNotes: [],
        items: [],
      });
    }
  }

  const quakes = await getJmaQuakes();
  const notableQuakes = quakes.fetchStatus === 'OK' ? selectNotableQuakes(quakes.items) : [];

  const messages: PushWorkItem[] = [];
  const updates: DeviceUpdate[] = [];
  const nowIso = new Date().toISOString();

  for (const device of devices) {
    if (!device.expoPushToken || device.subscribedCells.length === 0) continue;

    const cellByArea = new Map<string, string>();
    for (const cell of device.subscribedCells) {
      if (!cell.prefCode) continue;
      const area = `${cell.prefCode}0000`;
      if (!cellByArea.has(area)) cellByArea.set(area, cell.cellId);
    }

    const nextNotified = { ...(device.lastNotified ?? {}) };
    const sentCategories = new Set<string>();
    let sentCount = 0;

    for (const [area, cellId] of cellByArea.entries()) {
      if (sentCount >= MAX_PUSH_PER_DEVICE) break;
      const warnings = warningsByArea.get(area);
      if (!warnings || warnings.fetchStatus !== 'OK') continue;
      const items = dedupeWarningItems(warnings.items);
      for (const item of items) {
        if (sentCount >= MAX_PUSH_PER_DEVICE) break;
        if (isJmaLowPriorityWarning(item.kind)) continue;
        const level = warningLevel(item.kind);
        const category = `warning:${normalizeWarningCategory(item.kind)}`;
        if (sentCategories.has(category)) continue;
        const key = `${cellId}|${category}`;
        if (!shouldSend(key, level, nextNotified)) continue;

        const title = level === 'special' ? '特別警報' : level === 'warning' ? '警報' : '注意報';
        const body = warnings.areaName ? `${warnings.areaName}: ${item.kind}` : item.kind;
        messages.push({
          deviceId: device.deviceId,
          message: {
            to: device.expoPushToken,
            title,
            body,
            sound: 'default',
            channelId: 'alerts',
            priority: 'high',
            data: { type: 'warning', area, level },
          },
        });
        nextNotified[key] = { level, sentAt: nowIso };
        sentCategories.add(category);
        sentCount += 1;
      }
    }

    if (sentCount < MAX_PUSH_PER_DEVICE && notableQuakes.length > 0) {
      const cellId = device.subscribedCells[0]?.cellId ?? 'global';
      for (const quake of notableQuakes) {
        if (sentCount >= MAX_PUSH_PER_DEVICE) break;
        const level = quakeLevel(quake);
        if (!level) continue;
        const category = `quake:${quake.id}`;
        const key = `${cellId}|${category}`;
        if (!shouldSend(key, level, nextNotified)) continue;
        const body = `${quake.title} / 最大震度 ${quake.maxIntensity ?? '不明'}`;
        messages.push({
          deviceId: device.deviceId,
          message: {
            to: device.expoPushToken,
            title: '地震情報',
            body,
            sound: 'default',
            channelId: 'alerts',
            priority: 'high',
            data: { type: 'quake', level, quakeId: quake.id },
          },
        });
        nextNotified[key] = { level, sentAt: nowIso };
        sentCount += 1;
      }
    }

    updates.push({ deviceId: device.deviceId, lastNotified: nextNotified });
  }

  return { messages, updates, areaCodes };
}

function collectAreaCodes(devices: PushDeviceRecord[]): string[] {
  const set = new Set<string>();
  for (const device of devices) {
    for (const cell of device.subscribedCells) {
      if (!cell.prefCode) continue;
      const area = `${cell.prefCode}0000`;
      if (/^\d{6}$/.test(area)) set.add(area);
    }
  }
  return Array.from(set.values());
}

function normalizeWarningCategory(kind: string): string {
  const trimmed = kind.replace(/特別警報|警報|注意報/g, '').trim();
  return trimmed || kind;
}

function warningLevel(kind: string): 'advisory' | 'warning' | 'special' {
  if (/特別警報/.test(kind)) return 'special';
  if (/警報/.test(kind) && !/注意報/.test(kind)) return 'warning';
  return 'advisory';
}

function quakeLevel(item: { maxIntensity: string | null; magnitude: string | null }): 'strong' | 'notable' | null {
  if (item.maxIntensity && /[567]/.test(item.maxIntensity)) return 'strong';
  const mag = item.magnitude ? Number.parseFloat(item.magnitude) : null;
  if (mag && Number.isFinite(mag) && mag >= 5.5) return 'notable';
  return null;
}

function selectNotableQuakes(items: Array<{ time: string | null; maxIntensity: string | null; magnitude: string | null; id: string; title: string }>) {
  const sorted = items
    .slice()
    .sort((a, b) => Date.parse(b.time ?? '') - Date.parse(a.time ?? ''));
  return sorted.filter((item) => quakeLevel(item) !== null).slice(0, 3);
}

function dedupeWarningItems(items: NormalizedWarningItem[]): NormalizedWarningItem[] {
  const map = new Map<string, NormalizedWarningItem>();
  for (const item of items) {
    if (!item.kind) continue;
    const key = normalizeWarningCategory(item.kind);
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function shouldSend(
  key: string,
  level: string,
  lastNotified: Record<string, { level: string; sentAt: string }>
): boolean {
  const prev = lastNotified[key];
  if (!prev) return true;
  const prevRank = levelRank(prev.level);
  const nextRank = levelRank(level);
  if (nextRank > prevRank) return true;
  if (nextRank < prevRank) return false;
  const prevTime = Date.parse(prev.sentAt);
  if (!Number.isFinite(prevTime)) return true;
  return Date.now() - prevTime >= DEDUPE_WINDOW_MS;
}

function levelRank(level: string): number {
  if (level === 'special') return 3;
  if (level === 'warning') return 2;
  if (level === 'strong') return 2;
  return 1;
}
