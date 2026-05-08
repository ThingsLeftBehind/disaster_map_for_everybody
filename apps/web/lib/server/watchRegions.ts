import crypto from 'node:crypto';
import { prisma } from '../db/prisma';

const PLACE_LABELS = {
  home: '自宅',
  school: '学校',
  work: '職場',
  family: '実家',
  other: 'その他',
} as const;

const PLACE_TYPES = new Set(Object.keys(PLACE_LABELS));
const ALLOWED_RADIUS_KM = new Set([1, 3, 5, 10, 20]);
const META_PREFIX = '__hinanavi_place_v1__:';
const MAX_ACTIVE_PLACES = 10;

export type SavedPlaceType = keyof typeof PLACE_LABELS;

export type SavedPlaceRegion = {
  id: string;
  placeType: SavedPlaceType;
  placeTypeLabel: string;
  label: string;
  addressMemo: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  lat: number;
  lon: number;
  radiusKm: number;
  notifyEnabled: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type WatchRegionRow = {
  id: string;
  deviceId?: string;
  label: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  notifyEnabled?: boolean | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SavedPlaceRegionForNotification = SavedPlaceRegion & {
  deviceDbId: string;
};

type DeviceRef = { id: string; deviceHash: string };

export class WatchRegionApiError extends Error {
  status: number;
  errorCode: string;

  constructor(status: number, errorCode: string, message: string) {
    super(message);
    this.name = 'WatchRegionApiError';
    this.status = status;
    this.errorCode = errorCode;
  }
}

function safeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizePlaceType(value: unknown): SavedPlaceType {
  if (typeof value !== 'string') return 'other';
  const normalized = value.trim().toLowerCase();
  return PLACE_TYPES.has(normalized) ? (normalized as SavedPlaceType) : 'other';
}

function isValidPlaceType(value: unknown): boolean {
  return typeof value === 'string' && PLACE_TYPES.has(value.trim().toLowerCase());
}

function inferPlaceTypeFromLabel(label: string): SavedPlaceType {
  const trimmed = label.trim();
  const entry = Object.entries(PLACE_LABELS).find(([, ja]) => ja === trimmed);
  return (entry?.[0] as SavedPlaceType | undefined) ?? 'other';
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeCoordinate(value: unknown, min: number, max: number): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null || parsed < min || parsed > max) return null;
  return parsed;
}

function normalizeRadiusKm(value: unknown): number {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return 5;
  const rounded = Math.round(parsed);
  return ALLOWED_RADIUS_KM.has(rounded) ? rounded : 5;
}

function isValidRadiusKm(value: unknown): boolean {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return false;
  return ALLOWED_RADIUS_KM.has(Math.round(parsed));
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
  }
  return false;
}

function getOwnProperty(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function pickPresent(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function normalizePayload(raw: unknown, existing?: DecodedLabel): DecodedLabel & {
  latitude: number | null;
  longitude: number | null;
  radiusKm: number;
  active: boolean;
  hasActive: boolean;
  invalidPlaceType: boolean;
  invalidRadiusKm: boolean;
  invalidLatitude: boolean;
  invalidLongitude: boolean;
} {
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const coords = body.coords && typeof body.coords === 'object' && !Array.isArray(body.coords) ? (body.coords as Record<string, unknown>) : {};
  const rawPlaceType = pickPresent(body.placeType, body.type);
  const invalidPlaceType = rawPlaceType !== undefined && !isValidPlaceType(rawPlaceType);
  const placeType = rawPlaceType === undefined ? existing?.placeType ?? 'other' : normalizePlaceType(rawPlaceType);
  const label = safeText(pickPresent(body.label, body.name), 40) || existing?.label || PLACE_LABELS[placeType];
  const addressMemo = safeText(pickPresent(body.addressMemo, body.address, body.memo, existing?.addressMemo), 120) || null;
  const rawLatitude = pickPresent(body.latitude, body.lat, body.lastKnownLat, coords.latitude, coords.lat);
  const rawLongitude = pickPresent(body.longitude, body.lon, body.lng, body.lastKnownLon, coords.longitude, coords.lon, coords.lng);
  const latitude = normalizeCoordinate(rawLatitude, -90, 90);
  const longitude = normalizeCoordinate(rawLongitude, -180, 180);
  const rawRadiusKm = pickPresent(body.radiusKm, body.radius);
  const invalidRadiusKm = rawRadiusKm !== undefined && !isValidRadiusKm(rawRadiusKm);
  const radiusKm = rawRadiusKm === undefined ? existing?.radiusKm ?? 5 : normalizeRadiusKm(rawRadiusKm);
  const rawActive = getOwnProperty(body, 'active');

  return {
    placeType,
    label,
    addressMemo,
    notifyEnabled: normalizeBoolean(pickPresent(body.notifyEnabled, existing?.notifyEnabled)),
    radiusKm,
    latitude,
    longitude,
    active: rawActive === undefined ? true : normalizeBoolean(rawActive),
    hasActive: rawActive !== undefined,
    invalidPlaceType,
    invalidRadiusKm,
    invalidLatitude: rawLatitude !== undefined && latitude === null,
    invalidLongitude: rawLongitude !== undefined && longitude === null,
  };
}

type DecodedLabel = {
  placeType: SavedPlaceType;
  label: string;
  addressMemo: string | null;
  notifyEnabled: boolean;
  radiusKm?: number;
};

function decodeLabel(value: string): DecodedLabel {
  if (value.startsWith(META_PREFIX)) {
    try {
      const parsed = JSON.parse(value.slice(META_PREFIX.length));
      const placeType = normalizePlaceType(parsed?.placeType);
      const label = safeText(parsed?.label, 40) || PLACE_LABELS[placeType];
      const addressMemo = safeText(parsed?.addressMemo ?? parsed?.address, 120) || null;
      return {
        placeType,
        label,
        addressMemo,
        notifyEnabled: normalizeBoolean(parsed?.notifyEnabled),
      };
    } catch {
      // Fall back to the visible legacy label below.
    }
  }

  const label = safeText(value, 40) || PLACE_LABELS.other;
  const placeType = inferPlaceTypeFromLabel(label);
  return {
    placeType,
    label,
    addressMemo: null,
    notifyEnabled: false,
  };
}

function encodeLabel(value: DecodedLabel): string {
  const placeType = normalizePlaceType(value.placeType);
  const label = safeText(value.label, 40) || PLACE_LABELS[placeType];
  const addressMemo = safeText(value.addressMemo, 120) || null;
  return `${META_PREFIX}${JSON.stringify({
    placeType,
    label,
    addressMemo,
    notifyEnabled: Boolean(value.notifyEnabled),
  })}`;
}

function toSavedPlaceRegion(row: WatchRegionRow): SavedPlaceRegion {
  const decoded = decodeLabel(row.label);
  return {
    id: row.id,
    placeType: decoded.placeType,
    placeTypeLabel: PLACE_LABELS[decoded.placeType],
    label: decoded.label,
    addressMemo: decoded.addressMemo,
    address: decoded.addressMemo,
    latitude: row.latitude,
    longitude: row.longitude,
    lat: row.latitude,
    lon: row.longitude,
    radiusKm: row.radiusKm,
    notifyEnabled: Boolean(row.notifyEnabled ?? decoded.notifyEnabled),
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findDeviceByHash(deviceHash: string): Promise<DeviceRef | null> {
  return prisma.device.findUnique({
    where: { deviceHash },
    select: { id: true, deviceHash: true },
  });
}

async function resolveOrCreateDevice(deviceHash: string): Promise<DeviceRef> {
  const existing = await findDeviceByHash(deviceHash);
  if (existing) return existing;

  const now = new Date();
  try {
    return await prisma.device.create({
      data: {
        id: crypto.randomUUID(),
        deviceHash,
        transferCode: crypto.randomUUID(),
        updatedAt: now,
      },
      select: { id: true, deviceHash: true },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Unique constraint failed/i.test(message)) throw error;
    const raced = await findDeviceByHash(deviceHash);
    if (!raced) throw error;
    return raced;
  }
}

export function normalizeWatchRegionBody(raw: unknown, existing?: WatchRegionRow) {
  return normalizePayload(
    raw,
    existing
      ? {
          ...decodeLabel(existing.label),
          notifyEnabled: Boolean(existing.notifyEnabled || decodeLabel(existing.label).notifyEnabled),
          radiusKm: existing.radiusKm,
        }
      : undefined
  );
}

export async function listWatchRegions(deviceHash: string): Promise<SavedPlaceRegion[]> {
  const device = await findDeviceByHash(deviceHash.trim());
  if (!device) return [];

  const rows = await prisma.watchRegion.findMany({
    where: {
      deviceId: device.id,
      active: true,
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      label: true,
      latitude: true,
      longitude: true,
      radiusKm: true,
      active: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map(toSavedPlaceRegion);
}

export async function listNotifyEnabledWatchRegions(): Promise<SavedPlaceRegionForNotification[]> {
  const rows = await prisma.watchRegion.findMany({
    where: {
      active: true,
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      deviceId: true,
      label: true,
      latitude: true,
      longitude: true,
      radiusKm: true,
      active: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows
    .map((row) => ({
      ...toSavedPlaceRegion(row),
      deviceDbId: row.deviceId,
    }))
    .filter((region) => region.notifyEnabled);
}

export async function createWatchRegion(deviceHash: string, rawBody: unknown): Promise<SavedPlaceRegion> {
  const body = normalizeWatchRegionBody(rawBody);
  if (body.invalidPlaceType || body.invalidRadiusKm || body.invalidLatitude || body.invalidLongitude || body.latitude === null || body.longitude === null) {
    throw new WatchRegionApiError(400, 'invalid_payload', 'invalid_payload');
  }

  const device = await resolveOrCreateDevice(deviceHash.trim());
  const activeCount = await prisma.watchRegion.count({
    where: {
      deviceId: device.id,
      active: true,
    },
  });
  if (activeCount >= MAX_ACTIVE_PLACES) {
    throw new WatchRegionApiError(409, 'limit_exceeded', '登録できる場所は最大10件までです。');
  }

  const now = new Date();
  const row = await prisma.watchRegion.create({
    data: {
      id: crypto.randomUUID(),
      deviceId: device.id,
      label: encodeLabel(body),
      latitude: body.latitude,
      longitude: body.longitude,
      radiusKm: body.radiusKm,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    select: {
      id: true,
      label: true,
      latitude: true,
      longitude: true,
      radiusKm: true,
      active: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return toSavedPlaceRegion(row);
}

export async function updateWatchRegion(deviceHash: string, regionId: string, rawBody: unknown): Promise<SavedPlaceRegion | null> {
  const device = await findDeviceByHash(deviceHash.trim());
  if (!device) return null;

  const existing = await prisma.watchRegion.findFirst({
    where: {
      id: regionId,
      deviceId: device.id,
    },
    select: {
      id: true,
      label: true,
      latitude: true,
      longitude: true,
      radiusKm: true,
      active: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!existing) return null;

  const body = normalizeWatchRegionBody(rawBody, existing);
  if (body.invalidPlaceType || body.invalidRadiusKm || body.invalidLatitude || body.invalidLongitude) {
    throw new WatchRegionApiError(400, 'invalid_payload', 'invalid_payload');
  }
  const row = await prisma.watchRegion.update({
    where: { id: existing.id },
    data: {
      label: encodeLabel(body),
      latitude: body.latitude ?? existing.latitude,
      longitude: body.longitude ?? existing.longitude,
      radiusKm: body.radiusKm,
      active: body.hasActive ? body.active : existing.active,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      label: true,
      latitude: true,
      longitude: true,
      radiusKm: true,
      active: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return toSavedPlaceRegion(row);
}

export async function deleteWatchRegion(deviceHash: string, regionId: string): Promise<boolean> {
  const device = await findDeviceByHash(deviceHash.trim());
  if (!device) return false;

  const result = await prisma.watchRegion.updateMany({
    where: {
      id: regionId,
      deviceId: device.id,
    },
    data: {
      active: false,
      updatedAt: new Date(),
    },
  });

  return result.count > 0;
}

export const watchRegionPlaceLabels = PLACE_LABELS;
export const watchRegionMaxActivePlaces = MAX_ACTIVE_PLACES;
