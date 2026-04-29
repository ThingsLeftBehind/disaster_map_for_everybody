import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { prisma } from '../db/prisma';
import { MODERATION_DEFAULTS, STORE_LIMITS } from './config';
import { readJsonFile, atomicWriteJson } from './fs';
import { runExclusive } from './lock';
import {
  AdminStateSchema,
  AdminState,
  CheckinPrecision,
  CheckinReportsState,
  CheckinReportsStateSchema,
  DeviceState,
  DeviceStateSchema,
  ModerationState,
  ModerationStateSchema,
  ShelterCommunity,
  ShelterCommunitySchema,
  type CrowdVoteValue,
  type SavedArea,
  type Settings,
  type StoreResult,
} from './types';
import {
  localStoreAdminPath,
  localStoreCheckinReportsPath,
  localStoreDevicePath,
  localStoreDevicesDir,
  localStoreModerationPath,
  localStoreShelterPath,
} from './paths';
import { checkRateLimit } from './ratelimit';
import { decodeTransferCode, encodeTransferCode } from './transfer';

function nowIso(): string {
  return new Date().toISOString();
}

function pinPublicId(deviceId: string, checkinId: string): string {
  const salt = process.env.STORE_IP_SALT ?? 'dev-insecure-salt';
  return crypto.createHash('sha256').update(`${salt}:pin:${deviceId}:${checkinId}`).digest('hex').slice(0, 16);
}

function defaultAdminState(): AdminState {
  return {
    version: 1,
    banner: { text: null, updatedAt: null },
    moderationPolicy: {
      reportCautionThreshold: MODERATION_DEFAULTS.reportCautionThreshold,
      reportHideThreshold: MODERATION_DEFAULTS.reportHideThreshold,
    },
  };
}

function defaultModerationState(): ModerationState {
  return { version: 1, queue: [], updatedAt: null };
}

function defaultDeviceState(deviceId: string): DeviceState {
  return {
    version: 1,
    deviceId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    settings: {
      powerSaving: false,
      lowBandwidth: false,
      selectedAreaId: null,
      includePreciseShareLocation: false,
    },
    savedAreas: [],
    favorites: { shelterIds: [] },
    recent: { shelterIds: [] },
    checkins: [],
  };
}

function defaultShelterCommunity(shelterId: string): ShelterCommunity {
  return {
    version: 1,
    shelterId,
    updatedAt: nowIso(),
    votes: [],
    comments: [],
    reports: [],
  };
}

function defaultCheckinReportsState(): CheckinReportsState {
  return {
    version: 1,
    updatedAt: null,
    pins: {},
    reports: [],
  };
}

function withinWindow(iso: string, windowMs: number): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= windowMs;
}

function toDbSafetyStatus(status: string): 'SAFE' | 'EVACUATING' | 'EVACUATED' | 'INJURED' | 'ISOLATED' {
  if (status === 'COMPLETED' || status === 'EVACUATED') return 'EVACUATED';
  if (status === 'EVACUATING') return 'EVACUATING';
  if (status === 'INJURED') return 'INJURED';
  if (status === 'ISOLATED') return 'ISOLATED';
  return 'SAFE';
}

function fromDbSafetyStatus(status: string): string {
  if (status === 'EVACUATED') return 'COMPLETED';
  return status;
}

function normalizeCrowdVote(value: string): CrowdVoteValue {
  switch (value) {
    case 'SMOOTH':
    case 'NORMAL':
    case 'EVACUATING':
    case 'OK':
      return 'OK' as CrowdVoteValue;
    case 'VERY_CROWDED':
      return 'VERY_CROWDED' as CrowdVoteValue;
    case 'CROWDED':
      return 'CROWDED' as CrowdVoteValue;
    case 'BLOCKED':
      return 'BLOCKED' as CrowdVoteValue;
    case 'CLOSED':
      return 'CLOSED' as CrowdVoteValue;
    default:
      return 'OK' as CrowdVoteValue;
  }
}

function roundCoord(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function publicCheckinCoords(args: { lat: number; lon: number; precision: CheckinPrecision }): { lat: number; lon: number } {
  if (args.precision === 'PRECISE') return { lat: args.lat, lon: args.lon };
  return { lat: roundCoord(args.lat), lon: roundCoord(args.lon) };
}

function normalizedCheckinComment(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, 120);
  return text ? text : null;
}

function isSameCheckinPayload(
  last: unknown,
  next: {
    status: string;
    shelterId: string | null | undefined;
    lat: number;
    lon: number;
    precision: CheckinPrecision;
    comment: string | null | undefined;
  }
): boolean {
  const previous = last && typeof last === 'object' ? (last as Record<string, unknown>) : {};
  const lastLat = typeof previous.lat === 'number' ? previous.lat : null;
  const lastLon = typeof previous.lon === 'number' ? previous.lon : null;
  return (
    String(previous.status ?? '') === next.status &&
    (previous.shelterId ?? null) === (next.shelterId ?? null) &&
    (previous.precision === 'PRECISE' ? 'PRECISE' : 'COARSE') === next.precision &&
    normalizedCheckinComment(previous.comment) === normalizedCheckinComment(next.comment) &&
    lastLat === next.lat &&
    lastLon === next.lon
  );
}

function toDbCrowdStatus(value: string): 'OK' | 'CROWDED' | 'VERY_CROWDED' | 'CLOSED' | 'BLOCKED' {
  return normalizeCrowdVote(value) as 'OK' | 'CROWDED' | 'VERY_CROWDED' | 'CLOSED' | 'BLOCKED';
}

async function upsertDbSafetyStatus(args: {
  deviceId: string;
  status: string;
  lat: number;
  lon: number;
}): Promise<void> {
  try {
    await prisma.device_settings.upsert({
      where: { device_hash: args.deviceId },
      create: { device_hash: args.deviceId },
      update: {},
    });
    await prisma.safety_status.upsert({
      where: { device_hash: args.deviceId },
      create: {
        device_hash: args.deviceId,
        status: toDbSafetyStatus(args.status),
        last_known_lat: args.lat,
        last_known_lon: args.lon,
      },
      update: {
        status: toDbSafetyStatus(args.status),
        last_known_lat: args.lat,
        last_known_lon: args.lon,
        updated_at: new Date(),
      },
    });
  } catch (error) {
    console.warn('[store:safety] db_write_failed', { error: error instanceof Error ? error.message : String(error) });
  }
}

async function listDbSafetyPins(args: {
  includeOld: boolean;
  statuses?: string[] | null | undefined;
}): Promise<Array<{
  deviceKey: string;
  id: string;
  status: string;
  lat: number;
  lon: number;
  precision: CheckinPrecision;
  comment: string | null;
  updatedAt: string;
  archived: boolean;
  archivedAt: string | null;
  reportCount: number;
  commentHidden: boolean;
}>> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await prisma.safety_status.findMany({
      where: args.includeOld ? undefined : { updated_at: { gte: cutoff } },
      orderBy: { updated_at: 'desc' },
      take: 500,
    });
    const statusSet = new Set((args.statuses ?? []).filter(Boolean));
    return rows
      .map((row) => {
        const status = fromDbSafetyStatus(String(row.status));
        if (statusSet.size > 0 && !statusSet.has(status)) return null;
        if (typeof row.last_known_lat !== 'number' || typeof row.last_known_lon !== 'number') return null;
        return {
          deviceKey: row.device_hash,
          id: pinPublicId(row.device_hash, row.id),
          status,
          lat: row.last_known_lat,
          lon: row.last_known_lon,
          precision: 'COARSE' as CheckinPrecision,
          comment: null,
          updatedAt: row.updated_at.toISOString(),
          archived: false,
          archivedAt: null,
          reportCount: 0,
          commentHidden: false,
        };
      })
      .filter((v): v is NonNullable<typeof v> => Boolean(v));
  } catch (error) {
    console.warn('[store:safety] db_read_failed', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

async function appendDbCrowdReport(args: {
  shelterId: string;
  deviceId: string;
  value: string;
  comment?: string | null;
}): Promise<void> {
  try {
    await prisma.crowd_reports.create({
      data: {
        site_id: args.shelterId,
        device_hash: args.deviceId,
        status: toDbCrowdStatus(args.value),
        comment: args.comment?.trim() ? args.comment.trim().slice(0, 300) : null,
      },
    });
  } catch (error) {
    console.warn('[store:shelter] db_write_failed', { error: error instanceof Error ? error.message : String(error) });
  }
}

async function readDbShelterCommunity(shelterId: string): Promise<ShelterCommunity | null> {
  try {
    const rows = await prisma.crowd_reports.findMany({
      where: { site_id: shelterId },
      orderBy: { created_at: 'desc' },
      take: 500,
    });
    if (rows.length === 0) return null;

    const latestVotes = new Map<string, ShelterCommunity['votes'][number]>();
    const comments: ShelterCommunity['comments'] = [];
    let updatedAt: string | null = null;
    for (const row of rows) {
      const createdAt = row.created_at.toISOString();
      updatedAt = updatedAt ? (Date.parse(createdAt) > Date.parse(updatedAt) ? createdAt : updatedAt) : createdAt;
      if (!latestVotes.has(row.device_hash)) {
        latestVotes.set(row.device_hash, {
          id: row.id,
          deviceId: row.device_hash,
          ipHash: 'db',
          value: normalizeCrowdVote(String(row.status)),
          createdAt,
        });
      }
      if (row.comment?.trim()) {
        comments.push({
          id: row.id,
          deviceId: row.device_hash,
          ipHash: 'db',
          text: row.comment.trim(),
          createdAt,
          hidden: false,
          reportCount: 0,
        });
      }
    }

    return {
      version: 1,
      shelterId,
      updatedAt: updatedAt ?? nowIso(),
      votes: Array.from(latestVotes.values()),
      comments: comments.slice(0, STORE_LIMITS.maxCommentsPerShelter),
      reports: [],
    };
  } catch (error) {
    console.warn('[store:shelter] db_read_failed', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

async function deleteDbShelterCommunityForDevice(args: { shelterId: string; deviceId: string }): Promise<void> {
  try {
    await prisma.crowd_reports.deleteMany({
      where: { site_id: args.shelterId, device_hash: args.deviceId },
    });
  } catch (error) {
    console.warn('[store:shelter] db_delete_failed', { error: error instanceof Error ? error.message : String(error) });
  }
}

async function getCheckinReportsState(): Promise<CheckinReportsState> {
  const raw = await readJsonFile<unknown>(localStoreCheckinReportsPath());
  const parsed = CheckinReportsStateSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return defaultCheckinReportsState();
}

async function writeCheckinReportsState(next: CheckinReportsState): Promise<void> {
  await atomicWriteJson(localStoreCheckinReportsPath(), next);
}

export async function getAdminState(): Promise<AdminState> {
  const raw = await readJsonFile<unknown>(localStoreAdminPath());
  const parsed = AdminStateSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return defaultAdminState();
}

export async function setBanner(text: string | null): Promise<AdminState> {
  const { value } = await runExclusive('admin', async () => {
    const current = await getAdminState();
    const next: AdminState = {
      ...current,
      banner: { text, updatedAt: nowIso() },
    };
    await atomicWriteJson(localStoreAdminPath(), next);
    return next;
  });
  return value ?? getAdminState();
}

export async function getModerationState(): Promise<ModerationState> {
  const raw = await readJsonFile<unknown>(localStoreModerationPath());
  const parsed = ModerationStateSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return defaultModerationState();
}

async function writeModerationState(next: ModerationState): Promise<void> {
  await atomicWriteJson(localStoreModerationPath(), next);
}

export async function getDeviceState(deviceId: string): Promise<DeviceState> {
  const raw = await readJsonFile<unknown>(localStoreDevicePath(deviceId));
  const parsed = DeviceStateSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const created = defaultDeviceState(deviceId);
  await atomicWriteJson(localStoreDevicePath(deviceId), created);
  return created;
}

export async function updateDeviceState(
  deviceId: string,
  patch: Partial<{
    settings: Partial<Settings>;
    savedAreas: SavedArea[];
    favorites: { shelterIds: string[] };
    recent: { shelterIds: string[] };
  }>
): Promise<DeviceState> {
  const { value } = await runExclusive(`device:${deviceId}`, async () => {
    const current = await getDeviceState(deviceId);
    const next: DeviceState = {
      ...current,
      updatedAt: nowIso(),
      settings: { ...current.settings, ...(patch.settings ?? {}) },
      savedAreas: patch.savedAreas ? patch.savedAreas.slice(0, STORE_LIMITS.maxSavedAreas) : current.savedAreas,
      favorites: patch.favorites
        ? { shelterIds: Array.from(new Set(patch.favorites.shelterIds)).slice(0, STORE_LIMITS.maxFavorites) }
        : current.favorites,
      recent: patch.recent
        ? { shelterIds: Array.from(new Set(patch.recent.shelterIds)).slice(0, STORE_LIMITS.maxRecentShelters) }
        : current.recent,
    };

    await atomicWriteJson(localStoreDevicePath(deviceId), next);
    return next;
  });

  return value ?? getDeviceState(deviceId);
}

export async function appendCheckin(
  deviceId: string,
  entry: {
    status: string;
    shelterId: string | null | undefined;
    lat?: number | null | undefined;
    lon?: number | null | undefined;
    precision?: CheckinPrecision | null | undefined;
    comment?: string | null | undefined;
  }
): Promise<DeviceState> {
  const { value } = await runExclusive(`device:${deviceId}`, async () => {
    const current = await getDeviceState(deviceId);
    const next = buildNextDeviceStateWithCheckin(current, entry);
    await atomicWriteJson(localStoreDevicePath(deviceId), next);
    return next;
  });
  return value ?? getDeviceState(deviceId);
}

export async function clearActiveCheckin(deviceId: string): Promise<DeviceState> {
  const at = nowIso();
  const { value } = await runExclusive(`device:${deviceId}`, async () => {
    const current = await getDeviceState(deviceId);
    const next: DeviceState = {
      ...current,
      updatedAt: at,
      checkins: (current.checkins ?? []).map((c: any) =>
        c && typeof c === 'object' && (c as any).active !== false
          ? { ...(c as any), active: false, archivedAt: (c as any).archivedAt ?? at }
          : c
      ),
    };
    await atomicWriteJson(localStoreDevicePath(deviceId), next);
    return next;
  });

  try {
    await prisma.safety_status.delete({ where: { device_hash: deviceId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Record to delete does not exist|No record was found/i.test(message)) {
      console.warn('[store:safety] db_clear_failed', { error: message });
    }
  }

  return value ?? getDeviceState(deviceId);
}

function buildNextDeviceStateWithCheckin(
  current: DeviceState,
  entry: {
    status: string;
    shelterId: string | null | undefined;
    lat?: number | null | undefined;
    lon?: number | null | undefined;
    precision?: CheckinPrecision | null | undefined;
    comment?: string | null | undefined;
  }
): DeviceState {
  const at = nowIso();
  const normalizedExisting = (current.checkins ?? []).map((c, idx) => {
    const active = typeof (c as any).active === 'boolean' ? Boolean((c as any).active) : idx === 0;
    const archivedAt = typeof (c as any).archivedAt === 'string' || (c as any).archivedAt === null ? (c as any).archivedAt : null;
    return { ...(c as any), active, archivedAt: active ? null : archivedAt ?? (c as any).updatedAt ?? null };
  });
  const archivedExisting = normalizedExisting.map((c) => (c.active ? { ...c, active: false, archivedAt: at } : c));

  const comment = typeof entry.comment === 'string' && entry.comment.trim() ? entry.comment.trim().slice(0, 120) : null;
  const precision: CheckinPrecision = entry.precision === 'PRECISE' ? 'PRECISE' : 'COARSE';
  return {
    ...current,
    updatedAt: at,
    checkins: [
      {
        id: nanoid(10),
        status: entry.status as any,
        shelterId: entry.shelterId ?? null,
        updatedAt: at,
        lat: typeof entry.lat === 'number' ? entry.lat : null,
        lon: typeof entry.lon === 'number' ? entry.lon : null,
        precision,
        comment,
        active: true,
        archivedAt: null,
      },
      ...archivedExisting,
    ].slice(0, 50),
  } satisfies DeviceState;
}

export async function submitCheckinPin(args: {
  deviceId: string;
  ipHash: string;
  status: string;
  shelterId: string | null | undefined;
  lat: number;
  lon: number;
  precision: CheckinPrecision;
  comment: string | null | undefined;
}): Promise<StoreResult<DeviceState>> {
  const rlIp = checkRateLimit(`checkin:ip:${args.ipHash}`, 60, 60_000);
  if (!rlIp.ok) return { ok: false, code: 'RATE_LIMITED', message: 'Too many check-ins (ip)' };
  const rlDevice = checkRateLimit(`checkin:dev:${args.deviceId}`, 20, 60_000);
  if (!rlDevice.ok) return { ok: false, code: 'RATE_LIMITED', message: 'Too many check-ins (device)' };

  const { value } = await runExclusive(`device:${args.deviceId}`, async () => {
    const publicCoords = publicCheckinCoords({ lat: args.lat, lon: args.lon, precision: args.precision });
    const current = await getDeviceState(args.deviceId);
    const hasExplicitActive = (current.checkins ?? []).some((c: any) => c && typeof c === 'object' && typeof (c as any).active === 'boolean');
    const last = hasExplicitActive
      ? ((current.checkins ?? []).find((c: any) => c && typeof c === 'object' && (c as any).active === true) as any)
      : ((current.checkins ?? [])[0] as any);
    if (
      last?.updatedAt &&
      withinWindow(String(last.updatedAt), 15_000) &&
      isSameCheckinPayload(last, {
        status: args.status,
        shelterId: args.shelterId ?? null,
        lat: publicCoords.lat,
        lon: publicCoords.lon,
        precision: args.precision,
        comment: args.comment ?? null,
      })
    ) {
      return null;
    }

    const next = buildNextDeviceStateWithCheckin(current, {
      status: args.status,
      shelterId: args.shelterId ?? null,
      lat: publicCoords.lat,
      lon: publicCoords.lon,
      precision: args.precision,
      comment: args.comment ?? null,
    });
    await atomicWriteJson(localStoreDevicePath(args.deviceId), next);
    return next;
  });

  if (!value) return { ok: false, code: 'DUPLICATE', message: 'Please wait a moment before updating again.' };
  const dbCoords = { lat: roundCoord(args.lat), lon: roundCoord(args.lon) };
  await upsertDbSafetyStatus({ deviceId: args.deviceId, status: args.status, lat: dbCoords.lat, lon: dbCoords.lon });
  return { ok: true, value };
}

export async function listCheckinPins(args: {
  includeHistory: boolean;
  includeOld: boolean;
  statuses?: string[] | null | undefined;
}): Promise<{
  updatedAt: string | null;
  pins: Array<{
    id: string;
    status: string;
    lat: number;
    lon: number;
    precision: CheckinPrecision;
    comment: string | null;
    updatedAt: string;
    archived: boolean;
    archivedAt: string | null;
    reportCount: number;
    commentHidden: boolean;
  }>;
}> {
  const includeHistory = Boolean(args.includeHistory);
  const includeOld = Boolean(args.includeOld);
  const statusSet = new Set((args.statuses ?? []).filter((s) => typeof s === 'string' && s.trim()));

  const [reportsState, dbPins] = await Promise.all([
    getCheckinReportsState(),
    listDbSafetyPins({ includeOld, statuses: args.statuses }),
  ]);

  let files: string[] = [];
  try {
    files = (await fs.readdir(localStoreDevicesDir())).filter((f) => f.endsWith('.json'));
  } catch {
    files = [];
  }

  const pins: Array<{
    deviceKey: string;
    id: string;
    status: string;
    lat: number;
    lon: number;
    precision: CheckinPrecision;
    comment: string | null;
    updatedAt: string;
    archived: boolean;
    archivedAt: string | null;
    reportCount: number;
    commentHidden: boolean;
  }> = [];

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  for (const f of files.slice(0, 5000)) {
    const devicePath = path.join(localStoreDevicesDir(), f);
    const raw = await readJsonFile<unknown>(devicePath);
    const parsed = DeviceStateSchema.safeParse(raw);
    if (!parsed.success) continue;
    const device = parsed.data;
    const checkins = device.checkins ?? [];
    if (checkins.length === 0) continue;

    const hasExplicitActive = checkins.some((c: any) => c && typeof c === 'object' && typeof (c as any).active === 'boolean');
    const normalized = checkins.map((c: any, idx: number) => {
      const active = hasExplicitActive ? (c as any).active === true : idx === 0;
      return { ...c, active, archivedAt: active ? null : (c as any).archivedAt ?? (c as any).updatedAt ?? null };
    });

    for (const c of normalized) {
      if (!includeHistory && !c.active) continue;
      const t = Date.parse(String(c.updatedAt ?? ''));
      if (!includeOld && Number.isFinite(t) && t < cutoff) continue;
      const lat = typeof c.lat === 'number' ? c.lat : null;
      const lon = typeof c.lon === 'number' ? c.lon : null;
      if (lat === null || lon === null) continue;
      const status = String(c.status ?? '').trim();
      if (statusSet.size > 0 && !statusSet.has(status)) continue;

      const pinId = pinPublicId(device.deviceId, String(c.id ?? ''));
      const pinMeta = reportsState.pins?.[pinId] ?? null;

      pins.push({
        deviceKey: device.deviceId,
        id: pinId,
        status,
        lat,
        lon,
        precision: c.precision === 'PRECISE' ? 'PRECISE' : 'COARSE',
        comment: typeof c.comment === 'string' && c.comment.trim() ? c.comment.trim() : null,
        updatedAt: String(c.updatedAt ?? ''),
        archived: !c.active,
        archivedAt: typeof c.archivedAt === 'string' ? c.archivedAt : null,
        reportCount: typeof pinMeta?.reportCount === 'number' ? pinMeta.reportCount : 0,
        commentHidden: Boolean(pinMeta?.commentHidden),
      });
    }
  }

  const mergedByDevice = new Map<string, (typeof pins)[number]>();
  for (const pin of [...dbPins, ...pins]) {
    const existing = mergedByDevice.get(pin.deviceKey);
    if (!existing) {
      mergedByDevice.set(pin.deviceKey, pin);
      continue;
    }
    const existingTime = Date.parse(existing.updatedAt);
    const nextTime = Date.parse(pin.updatedAt);
    const nextHasMoreDetail = Boolean(pin.comment) && !existing.comment;
    if (nextHasMoreDetail || (Number.isFinite(nextTime) && (!Number.isFinite(existingTime) || nextTime > existingTime))) {
      mergedByDevice.set(pin.deviceKey, pin);
    }
  }

  const mergedPins = Array.from(mergedByDevice.values());
  mergedPins.sort((a, b) => {
    const ta = Date.parse(a.updatedAt);
    const tb = Date.parse(b.updatedAt);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });

  const updatedAt = mergedPins.length > 0 ? mergedPins[0].updatedAt : null;
  return {
    updatedAt,
    pins: mergedPins.slice(0, 500).map((pin) => {
      const { deviceKey, ...publicPin } = pin;
      void deviceKey;
      return publicPin;
    }),
  };
}

export async function reportCheckinPin(args: {
  pinId: string;
  deviceId: string;
  ipHash: string;
  reason: string | null | undefined;
}): Promise<StoreResult<{ reportCount: number; commentHidden: boolean }>> {
  const rlIp = checkRateLimit(`pinreport:ip:${args.ipHash}`, 80, 60_000);
  if (!rlIp.ok) return { ok: false, code: 'RATE_LIMITED', message: 'Too many reports (ip)' };
  const rlDevice = checkRateLimit(`pinreport:dev:${args.deviceId}`, 30, 60_000);
  if (!rlDevice.ok) return { ok: false, code: 'RATE_LIMITED', message: 'Too many reports (device)' };

  const admin = await getAdminState();

  const { value } = await runExclusive('checkin_reports', async () => {
    const current = await getCheckinReportsState();
    const already = current.reports.find(
      (r) => r.pinId === args.pinId && r.deviceId === args.deviceId && withinWindow(r.createdAt, STORE_LIMITS.reportWindowMs)
    );
    if (already) return null;

    const existing = current.pins[args.pinId] ?? { reportCount: 0, commentHidden: false };
    const reportCount = (existing.reportCount ?? 0) + 1;
    const commentHidden = reportCount >= admin.moderationPolicy.reportHideThreshold;

    const next: CheckinReportsState = {
      ...current,
      updatedAt: nowIso(),
      pins: {
        ...current.pins,
        [args.pinId]: { reportCount, commentHidden },
      },
      reports: [
        {
          id: nanoid(10),
          pinId: args.pinId,
          deviceId: args.deviceId,
          ipHash: args.ipHash,
          reason: args.reason ?? null,
          createdAt: nowIso(),
        },
        ...current.reports,
      ].slice(0, 5000),
    };

    await writeCheckinReportsState(next);
    return next.pins[args.pinId];
  });

  if (!value) return { ok: false, code: 'DUPLICATE', message: 'Already reported recently.' };
  return { ok: true, value };
}

async function getShelterCommunity(shelterId: string): Promise<ShelterCommunity> {
  const raw = await readJsonFile<unknown>(localStoreShelterPath(shelterId));
  const parsed = ShelterCommunitySchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const created = defaultShelterCommunity(shelterId);
  await atomicWriteJson(localStoreShelterPath(shelterId), created);
  return created;
}

async function writeShelterCommunity(next: ShelterCommunity): Promise<void> {
  await atomicWriteJson(localStoreShelterPath(next.shelterId), next);
}

export async function getShelterCommunitySnapshot(shelterId: string): Promise<ShelterCommunity> {
  const dbCommunity = await readDbShelterCommunity(shelterId);
  if (dbCommunity) return dbCommunity;
  const fsCommunity = await getShelterCommunity(shelterId);
  return {
    ...fsCommunity,
    votes: fsCommunity.votes.map((vote) => ({ ...vote, value: normalizeCrowdVote(vote.value) })),
  };
}

export async function submitVote(args: {
  shelterId: string;
  deviceId: string;
  ipHash: string;
  value: CrowdVoteValue;
  comment?: string | null;
}): Promise<StoreResult<ShelterCommunity>> {
  const rlIp = checkRateLimit(`vote:ip:${args.ipHash}`, 40, 60_000);
  if (!rlIp.ok) return { ok: false, code: 'RATE_LIMITED', message: 'Too many votes (ip)' };
  const rlDevice = checkRateLimit(`vote:dev:${args.deviceId}`, 15, 60_000);
  if (!rlDevice.ok) return { ok: false, code: 'RATE_LIMITED', message: 'Too many votes (device)' };

  const { value } = await runExclusive(`shelter:${args.shelterId}`, async () => {
    const current = await getShelterCommunity(args.shelterId);
    const normalizedValue = normalizeCrowdVote(args.value);
    const comment = typeof args.comment === 'string' && args.comment.trim() ? args.comment.trim().slice(0, 300) : null;

    const next: ShelterCommunity = {
      ...current,
      updatedAt: nowIso(),
      votes: [
        { id: nanoid(10), deviceId: args.deviceId, ipHash: args.ipHash, value: normalizedValue, createdAt: nowIso() },
        ...current.votes.filter((v) => v.deviceId !== args.deviceId),
      ].slice(0, STORE_LIMITS.maxVotesHistoryPerShelter),
      comments: comment
        ? [
            {
              id: nanoid(10),
              deviceId: args.deviceId,
              ipHash: args.ipHash,
              text: comment,
              createdAt: nowIso(),
              hidden: false,
              reportCount: 0,
            },
            ...current.comments,
          ].slice(0, STORE_LIMITS.maxCommentsPerShelter)
        : current.comments,
    };
    await writeShelterCommunity(next);
    return next;
  });

  if (!value) return { ok: false, code: 'DUPLICATE', message: 'Please wait before voting again for this shelter.' };
  await appendDbCrowdReport({ shelterId: args.shelterId, deviceId: args.deviceId, value: args.value, comment: args.comment ?? null });
  return { ok: true, value };
}

export async function submitComment(args: {
  shelterId: string;
  deviceId: string;
  ipHash: string;
  text: string;
}): Promise<StoreResult<ShelterCommunity>> {
  const rlIp = checkRateLimit(`comment:ip:${args.ipHash}`, 30, 60_000);
  if (!rlIp.ok) return { ok: false, code: 'RATE_LIMITED', message: 'Too many comments (ip)' };
  const rlDevice = checkRateLimit(`comment:dev:${args.deviceId}`, 10, 60_000);
  if (!rlDevice.ok) return { ok: false, code: 'RATE_LIMITED', message: 'Too many comments (device)' };

  const { value } = await runExclusive(`shelter:${args.shelterId}`, async () => {
    const current = await getShelterCommunity(args.shelterId);
    const recent = current.comments.find(
      (c) => c.deviceId === args.deviceId && withinWindow(c.createdAt, STORE_LIMITS.commentWindowMs)
    );
    if (recent) return null;

    const next: ShelterCommunity = {
      ...current,
      updatedAt: nowIso(),
      comments: [
        {
          id: nanoid(10),
          deviceId: args.deviceId,
          ipHash: args.ipHash,
          text: args.text,
          createdAt: nowIso(),
          hidden: false,
          reportCount: 0,
        },
        ...current.comments,
      ].slice(0, STORE_LIMITS.maxCommentsPerShelter),
    };
    await writeShelterCommunity(next);
    return next;
  });

  if (!value) return { ok: false, code: 'DUPLICATE', message: 'Please wait before posting another comment.' };
  await appendDbCrowdReport({ shelterId: args.shelterId, deviceId: args.deviceId, value: 'OK', comment: args.text });
  return { ok: true, value };
}

export async function deleteShelterVoteAndComment(args: {
  shelterId: string;
  deviceId: string;
}): Promise<StoreResult<ShelterCommunity>> {
  const { value } = await runExclusive(`shelter:${args.shelterId}`, async () => {
    const current = await getShelterCommunity(args.shelterId);

    // Remove votes by this device
    const nextVotes = current.votes.filter((v) => v.deviceId !== args.deviceId);

    // Remove comments by this device (and any associated reports? user requesting "clear own vote/comment")
    // If we remove the comment, reports targeting it might become orphans or we should just drop them?
    // Let's just filter out the comment. The reports can stay or be filtered if we matched IDs, but simple is best for now.
    const nextComments = current.comments.filter((c) => c.deviceId !== args.deviceId);

    const next: ShelterCommunity = {
      ...current,
      updatedAt: nowIso(),
      votes: nextVotes,
      comments: nextComments,
    };
    await writeShelterCommunity(next);
    return next;
  });

  if (!value) return { ok: false, code: 'NOT_FOUND', message: 'Failed to update.' };
  await deleteDbShelterCommunityForDevice(args);
  return { ok: true, value };
}

export async function reportComment(args: {
  shelterId: string;
  deviceId: string;
  ipHash: string;
  commentId: string;
  reason: string | null | undefined;
}): Promise<StoreResult<ShelterCommunity>> {
  const rlIp = checkRateLimit(`report:ip:${args.ipHash}`, 50, 60_000);
  if (!rlIp.ok) return { ok: false, code: 'RATE_LIMITED', message: 'Too many reports (ip)' };
  const rlDevice = checkRateLimit(`report:dev:${args.deviceId}`, 20, 60_000);
  if (!rlDevice.ok) return { ok: false, code: 'RATE_LIMITED', message: 'Too many reports (device)' };

  const admin = await getAdminState();

  const { value } = await runExclusive(`shelter:${args.shelterId}`, async () => {
    const current = await getShelterCommunity(args.shelterId);
    const comment = current.comments.find((c) => c.id === args.commentId);
    if (!comment) return null;

    const already = current.reports.find(
      (r) => r.commentId === args.commentId && r.deviceId === args.deviceId && withinWindow(r.createdAt, STORE_LIMITS.reportWindowMs)
    );
    if (already) return null;

    const nextComments = current.comments.map((c) =>
      c.id === args.commentId ? { ...c, reportCount: (c.reportCount ?? 0) + 1 } : c
    );

    const updatedComment = nextComments.find((c) => c.id === args.commentId)!;
    const shouldHide = updatedComment.reportCount >= admin.moderationPolicy.reportHideThreshold;

    const finalComments = nextComments.map((c) =>
      c.id === args.commentId ? { ...c, hidden: c.hidden || shouldHide } : c
    );

    const next: ShelterCommunity = {
      ...current,
      updatedAt: nowIso(),
      comments: finalComments,
      reports: [
        {
          id: nanoid(10),
          commentId: args.commentId,
          deviceId: args.deviceId,
          ipHash: args.ipHash,
          reason: args.reason ?? null,
          createdAt: nowIso(),
        },
        ...current.reports,
      ].slice(0, 500),
    };

    await writeShelterCommunity(next);

    if (updatedComment.reportCount >= admin.moderationPolicy.reportCautionThreshold) {
      await runExclusive('moderation', async () => {
        const moderation = await getModerationState();
        const exists = moderation.queue.some(
          (q) => q.shelterId === args.shelterId && q.commentId === args.commentId
        );
        if (!exists) {
          moderation.queue.unshift({
            id: nanoid(10),
            shelterId: args.shelterId,
            commentId: args.commentId,
            reportCount: updatedComment.reportCount,
            createdAt: nowIso(),
          });
          moderation.updatedAt = nowIso();
          await writeModerationState(moderation);
        }
      });
    }

    return next;
  });

  if (!value) return { ok: false, code: 'DUPLICATE', message: 'Already reported recently or comment not found.' };
  return { ok: true, value };
}

export async function moderationAction(args: {
  action: 'HIDE_COMMENT' | 'UNHIDE_COMMENT' | 'DELETE_FROM_QUEUE';
  shelterId: string;
  commentId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (args.action === 'DELETE_FROM_QUEUE') {
    await runExclusive('moderation', async () => {
      const moderation = await getModerationState();
      moderation.queue = moderation.queue.filter((q) => !(q.shelterId === args.shelterId && q.commentId === args.commentId));
      moderation.updatedAt = nowIso();
      await writeModerationState(moderation);
    });
    return { ok: true };
  }

  await runExclusive(`shelter:${args.shelterId}`, async () => {
    const current = await getShelterCommunity(args.shelterId);
    const next: ShelterCommunity = {
      ...current,
      updatedAt: nowIso(),
      comments: current.comments.map((c) =>
        c.id === args.commentId ? { ...c, hidden: args.action === 'HIDE_COMMENT' } : c
      ),
    };
    await writeShelterCommunity(next);
  });

  await runExclusive('moderation', async () => {
    const moderation = await getModerationState();
    moderation.queue = moderation.queue.filter((q) => !(q.shelterId === args.shelterId && q.commentId === args.commentId));
    moderation.updatedAt = nowIso();
    await writeModerationState(moderation);
  });

  return { ok: true };
}

export async function exportTransferCode(deviceId: string): Promise<StoreResult<{ code: string }>> {
  const device = await getDeviceState(deviceId);
  const payload = {
    v: 1,
    savedAreas: device.savedAreas,
    favorites: device.favorites,
    settings: device.settings,
  };
  return { ok: true, value: { code: encodeTransferCode(payload) } };
}

export async function importTransferCode(deviceId: string, code: string): Promise<StoreResult<DeviceState>> {
  const decoded = decodeTransferCode(code.trim());
  if (!decoded.ok) return { ok: false, code: 'BAD_REQUEST', message: decoded.message };

  const payload = decoded.payload ?? {};
  if (payload.v !== 1) return { ok: false, code: 'BAD_REQUEST', message: 'Unsupported version' };

  const savedAreas = Array.isArray(payload.savedAreas) ? payload.savedAreas : [];
  const favorites = payload.favorites && typeof payload.favorites === 'object' ? payload.favorites : null;
  const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : null;

  const next = await updateDeviceState(deviceId, {
    savedAreas,
    favorites: favorites ? { shelterIds: Array.isArray(favorites.shelterIds) ? favorites.shelterIds : [] } : undefined,
    settings: settings ? settings : undefined,
  });

  return { ok: true, value: next };
}
