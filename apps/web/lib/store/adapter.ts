import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { Prisma, prisma } from '../db/prisma';
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

function requiresDbPersistence(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production');
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

type CrowdStoreKind = 'crowd_reports' | 'site_status_report' | 'none';
type LegacyCongestionLevel = 'low' | 'normal' | 'high';
type LegacyAccessibilityLevel = 'accessible' | 'blocked' | 'unknown';

const CROWD_STORE_META_TTL_MS = 5 * 60_000;
const LEGACY_VOTE_PREFIX_RE = /^\[hinanavi:v1:vote=(OK|CROWDED|VERY_CROWDED|CLOSED|BLOCKED)\]\n?/;

let cachedCrowdStoreKind: { checkedAtMs: number; kind: CrowdStoreKind } | null = null;

function toIsoFromDb(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return nowIso();
}

function toLegacyCrowdFields(value: string): {
  congestion: LegacyCongestionLevel;
  accessibility: LegacyAccessibilityLevel;
} {
  switch (normalizeCrowdVote(value)) {
    case 'CROWDED':
    case 'VERY_CROWDED':
      return { congestion: 'high', accessibility: 'accessible' };
    case 'CLOSED':
    case 'BLOCKED':
      return { congestion: 'normal', accessibility: 'blocked' };
    case 'OK':
    default:
      return { congestion: 'normal', accessibility: 'accessible' };
  }
}

function fromLegacyCrowdFields(args: {
  congestion: unknown;
  accessibility: unknown;
  comment: unknown;
}): { value: CrowdVoteValue; publicComment: string | null } {
  const rawComment = typeof args.comment === 'string' ? args.comment : '';
  const marker = rawComment.match(LEGACY_VOTE_PREFIX_RE);
  const publicText = rawComment.replace(LEGACY_VOTE_PREFIX_RE, '').trim();
  if (marker?.[1]) {
    return { value: normalizeCrowdVote(marker[1]), publicComment: publicText || null };
  }

  const accessibility = String(args.accessibility ?? '').toLowerCase();
  if (accessibility === 'blocked') return { value: 'BLOCKED', publicComment: publicText || null };

  const congestion = String(args.congestion ?? '').toLowerCase();
  if (congestion === 'high') return { value: 'CROWDED', publicComment: publicText || null };
  return { value: 'OK', publicComment: publicText || null };
}

function encodeLegacyReportComment(value: string, comment: string | null | undefined): string {
  const exactValue = normalizeCrowdVote(value);
  const publicComment = typeof comment === 'string' && comment.trim() ? comment.trim().slice(0, 300) : '';
  return publicComment ? `[hinanavi:v1:vote=${exactValue}]\n${publicComment}` : `[hinanavi:v1:vote=${exactValue}]`;
}

async function getCrowdStoreKind(): Promise<CrowdStoreKind> {
  const now = Date.now();
  if (cachedCrowdStoreKind && now - cachedCrowdStoreKind.checkedAtMs < CROWD_STORE_META_TTL_MS) {
    return cachedCrowdStoreKind.kind;
  }

  try {
    const rows = (await prisma.$queryRaw(
      Prisma.sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('crowd_reports', 'SiteStatusReport')
      `
    )) as Array<{ table_name: unknown }>;
    const names = new Set(rows.map((row) => String(row.table_name ?? '')));
    const kind: CrowdStoreKind = names.has('crowd_reports')
      ? 'crowd_reports'
      : names.has('SiteStatusReport')
        ? 'site_status_report'
        : 'none';
    cachedCrowdStoreKind = { checkedAtMs: now, kind };
    return kind;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[store:shelter] db_store_detect_failed', { error: message });
    if (requiresDbPersistence()) throw error;
    cachedCrowdStoreKind = { checkedAtMs: now, kind: 'none' };
    return 'none';
  }
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

async function upsertDbCrowdReport(args: {
  shelterId: string;
  deviceId: string;
  value: string;
  comment?: string | null;
}): Promise<boolean> {
  const kind = await getCrowdStoreKind();
  if (kind === 'none') return false;

  try {
    if (kind === 'crowd_reports') {
      await prisma.$transaction([
        prisma.crowd_reports.deleteMany({
          where: { site_id: args.shelterId, device_hash: args.deviceId },
        }),
        prisma.crowd_reports.create({
          data: {
            site_id: args.shelterId,
            device_hash: args.deviceId,
            status: toDbCrowdStatus(args.value),
            comment: args.comment?.trim() ? args.comment.trim().slice(0, 300) : null,
          },
        }),
      ]);
      return true;
    }

    const legacy = toLegacyCrowdFields(args.value);
    const rowId = crypto.randomUUID();
    const comment = encodeLegacyReportComment(args.value, args.comment);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`
          DELETE FROM "public"."SiteStatusReport"
          WHERE "siteId" = ${args.shelterId}::uuid
            AND "deviceHash" = ${args.deviceId}
        `
      );
      await tx.$executeRaw(
        Prisma.sql`
          INSERT INTO "public"."SiteStatusReport" (
            "id",
            "siteId",
            "deviceHash",
            "deviceId",
            "congestionLevel",
            "accessibility",
            "comment",
            "reportedAt"
          )
          VALUES (
            ${rowId}::uuid,
            ${args.shelterId}::uuid,
            ${args.deviceId},
            NULL,
            ${legacy.congestion}::"CongestionLevel",
            ${legacy.accessibility}::"AccessibilityLevel",
            ${comment},
            NOW()
          )
        `
      );
    });
    return true;
  } catch (error) {
    console.warn('[store:shelter] db_write_failed', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

async function readDbShelterCommunity(shelterId: string): Promise<ShelterCommunity | null> {
  const kind = await getCrowdStoreKind();
  if (kind === 'none') {
    if (requiresDbPersistence()) throw new Error('Shelter community persistence store not found.');
    return null;
  }

  try {
    const rows =
      kind === 'crowd_reports'
        ? await prisma.crowd_reports.findMany({
            where: { site_id: shelterId },
            orderBy: { created_at: 'desc' },
            take: 500,
          })
        : ((await prisma.$queryRaw(
            Prisma.sql`
              SELECT
                "id",
                "deviceHash",
                "congestionLevel"::text AS "congestionLevel",
                "accessibility"::text AS "accessibility",
                "comment",
                "reportedAt"
              FROM "public"."SiteStatusReport"
              WHERE "siteId" = ${shelterId}::uuid
              ORDER BY "reportedAt" DESC
              LIMIT 500
            `
          )) as Array<{
            id: unknown;
            deviceHash: unknown;
            congestionLevel: unknown;
            accessibility: unknown;
            comment: unknown;
            reportedAt: unknown;
          }>);
    if (rows.length === 0) return requiresDbPersistence() ? defaultShelterCommunity(shelterId) : null;

    const latestVotes = new Map<string, ShelterCommunity['votes'][number]>();
    const comments: ShelterCommunity['comments'] = [];
    let updatedAt: string | null = null;
    for (const row of rows as any[]) {
      const deviceHash = kind === 'crowd_reports' ? row.device_hash : String(row.deviceHash ?? '');
      if (!deviceHash) continue;
      const createdAt = kind === 'crowd_reports' ? row.created_at.toISOString() : toIsoFromDb(row.reportedAt);
      updatedAt = updatedAt ? (Date.parse(createdAt) > Date.parse(updatedAt) ? createdAt : updatedAt) : createdAt;
      const legacy = kind === 'site_status_report'
        ? fromLegacyCrowdFields({
            congestion: row.congestionLevel,
            accessibility: row.accessibility,
            comment: row.comment,
          })
        : null;
      const status = legacy ? legacy.value : normalizeCrowdVote(String(row.status));
      const commentText = legacy ? legacy.publicComment : typeof row.comment === 'string' && row.comment.trim() ? row.comment.trim() : null;
      if (!latestVotes.has(deviceHash)) {
        latestVotes.set(deviceHash, {
          id: String(row.id),
          deviceId: deviceHash,
          ipHash: 'db',
          value: status,
          createdAt,
        });
      }
      if (commentText) {
        comments.push({
          id: String(row.id),
          deviceId: deviceHash,
          ipHash: 'db',
          text: commentText,
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
    if (requiresDbPersistence()) throw error;
    return null;
  }
}

async function deleteDbShelterCommunityForDevice(args: { shelterId: string; deviceId: string }): Promise<boolean> {
  const kind = await getCrowdStoreKind();
  if (kind === 'none') return false;

  try {
    if (kind === 'crowd_reports') {
      await prisma.crowd_reports.deleteMany({
        where: { site_id: args.shelterId, device_hash: args.deviceId },
      });
    } else {
      await prisma.$executeRaw(
        Prisma.sql`
          DELETE FROM "public"."SiteStatusReport"
          WHERE "siteId" = ${args.shelterId}::uuid
            AND "deviceHash" = ${args.deviceId}
        `
      );
    }
    return true;
  } catch (error) {
    console.warn('[store:shelter] db_delete_failed', { error: error instanceof Error ? error.message : String(error) });
    return false;
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

const SHELTER_ACTIVE_POST_LIMIT = 5;
const SHELTER_POST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SHELTER_SUMMARY_WINDOW_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
} as const;
type ShelterSummaryWindowKey = keyof typeof SHELTER_SUMMARY_WINDOW_MS;
type SiteConditionKindLower = 'ok' | 'crowded' | 'very_crowded' | 'closed' | 'blocked';

function toDeviceHash(deviceId: string): string {
  return deviceId.trim();
}

function normalizeSummaryWindowKey(value: string | null | undefined): ShelterSummaryWindowKey {
  if (value === '3d' || value === '7d') return value;
  return '24h';
}

function normalizeSiteConditionKind(value: string): SiteConditionKindLower {
  const normalized = String(value ?? '').trim();
  switch (normalized) {
    case 'ok':
    case 'OK':
    case 'SMOOTH':
    case 'NORMAL':
    case 'EVACUATING':
      return 'ok';
    case 'crowded':
    case 'CROWDED':
      return 'crowded';
    case 'very_crowded':
    case 'VERY_CROWDED':
      return 'very_crowded';
    case 'closed':
    case 'CLOSED':
      return 'closed';
    case 'blocked':
    case 'BLOCKED':
      return 'blocked';
    default:
      return 'ok';
  }
}

function toCompatibilityLevels(conditionKind: SiteConditionKindLower): {
  congestionLevel: 'low' | 'normal' | 'high';
  accessibility: 'accessible' | 'blocked';
} {
  switch (conditionKind) {
    case 'ok':
      return { congestionLevel: 'low', accessibility: 'accessible' };
    case 'crowded':
      return { congestionLevel: 'normal', accessibility: 'accessible' };
    case 'very_crowded':
      return { congestionLevel: 'high', accessibility: 'accessible' };
    case 'closed':
    case 'blocked':
      return { congestionLevel: 'high', accessibility: 'blocked' };
    default:
      return { congestionLevel: 'normal', accessibility: 'accessible' };
  }
}

function sanitizeShelterComment(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const withoutTags = raw.replace(/<[^>]+>/g, ' ');
  const withoutUrls = withoutTags.replace(/(?:https?:\/\/|www\.)\S+/gi, ' ');
  const compact = withoutUrls.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  return compact.slice(0, 140);
}

async function resolveSiteId(rawId: string, activeOnly: boolean): Promise<string | null> {
  const site = await prisma.evacSite.findFirst({
    where: {
      OR: [{ id: rawId }, { sourceId: rawId }],
      ...(activeOnly ? { isActive: true } : {}),
    },
    select: { id: true },
  });
  return site?.id ?? null;
}

async function readActiveSiteReports(siteId: string) {
  const now = new Date();
  return prisma.siteStatusReport.findMany({
    where: {
      siteId,
      deletedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { reportedAt: 'desc' },
    take: 500,
    select: {
      id: true,
      deviceHash: true,
      comment: true,
      conditionKind: true,
      reportedAt: true,
      updatedAt: true,
      expiresAt: true,
    },
  });
}

function buildShelterCommunityFromReports(
  shelterId: string,
  rows: Array<{
    id: string;
    deviceHash: string;
    comment: string | null;
    conditionKind: string;
    reportedAt: Date;
    updatedAt: Date;
    expiresAt: Date;
  }>
): ShelterCommunity {
  let latestAt = nowIso();
  const votes: ShelterCommunity['votes'] = [];
  const comments: ShelterCommunity['comments'] = [];

  for (const row of rows) {
    const voteAt = row.reportedAt.toISOString();
    const updatedAt = row.updatedAt.toISOString();
    latestAt = Date.parse(updatedAt) > Date.parse(latestAt) ? updatedAt : latestAt;
    votes.push({
      id: row.id,
      deviceId: row.deviceHash,
      ipHash: 'db',
      value: normalizeSiteConditionKind(String(row.conditionKind)),
      createdAt: voteAt,
    });
    const text = sanitizeShelterComment(row.comment);
    if (text) {
      comments.push({
        id: row.id,
        deviceId: row.deviceHash,
        ipHash: 'db',
        text,
        createdAt: voteAt,
        hidden: false,
        reportCount: 0,
      });
    }
  }

  return {
    version: 1,
    shelterId,
    updatedAt: latestAt,
    votes,
    comments: comments.slice(0, STORE_LIMITS.maxCommentsPerShelter),
    reports: [],
  };
}

async function listActiveShelterPostsByDeviceHash(deviceHash: string): Promise<
  Array<{
    siteId: string;
    siteName: string;
    conditionKind: SiteConditionKindLower;
    comment: string | null;
    reportedAt: string;
    expiresAt: string;
  }>
> {
  const now = new Date();
  const rows = await prisma.siteStatusReport.findMany({
    where: {
      deviceHash,
      deletedAt: null,
      expiresAt: { gt: now },
      EvacSite: { isActive: true },
    },
    orderBy: { reportedAt: 'desc' },
    take: SHELTER_ACTIVE_POST_LIMIT,
    select: {
      siteId: true,
      conditionKind: true,
      comment: true,
      reportedAt: true,
      expiresAt: true,
      EvacSite: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    siteId: row.siteId,
    siteName: row.EvacSite?.name ?? '避難場所',
    conditionKind: normalizeSiteConditionKind(String(row.conditionKind)),
    comment: sanitizeShelterComment(row.comment),
    reportedAt: row.reportedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

async function persistShelterStatusReport(args: {
  shelterId: string;
  deviceHash: string;
  conditionKind: SiteConditionKindLower;
  comment: string | null;
}): Promise<StoreResult<{ siteId: string }>> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHELTER_POST_TTL_MS);
  const siteId = await resolveSiteId(args.shelterId, true);
  if (!siteId) {
    return { ok: false, code: 'BAD_REQUEST', message: 'Shelter not found or inactive.' };
  }

  const existing = await prisma.siteStatusReport.findUnique({
    where: { siteId_deviceHash: { siteId, deviceHash: args.deviceHash } },
    select: { id: true },
  });

  if (!existing) {
    const activeCount = await prisma.siteStatusReport.count({
      where: {
        deviceHash: args.deviceHash,
        deletedAt: null,
        expiresAt: { gt: now },
        EvacSite: { isActive: true },
      },
    });
    if (activeCount >= SHELTER_ACTIVE_POST_LIMIT) {
      const activePosts = await listActiveShelterPostsByDeviceHash(args.deviceHash);
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'ACTIVE_POST_LIMIT_REACHED',
        details: {
          activePosts,
          activePostCount: activePosts.length,
          activePostLimit: SHELTER_ACTIVE_POST_LIMIT,
        },
      };
    }
  }

  const compatible = toCompatibilityLevels(args.conditionKind);
  await prisma.siteStatusReport.upsert({
    where: { siteId_deviceHash: { siteId, deviceHash: args.deviceHash } },
    create: {
      id: crypto.randomUUID(),
      siteId,
      deviceHash: args.deviceHash,
      deviceId: null,
      congestionLevel: compatible.congestionLevel,
      accessibility: compatible.accessibility,
      comment: args.comment,
      conditionKind: args.conditionKind,
      reportedAt: now,
      updatedAt: now,
      deletedAt: null,
      expiresAt,
    },
    update: {
      congestionLevel: compatible.congestionLevel,
      accessibility: compatible.accessibility,
      comment: args.comment,
      conditionKind: args.conditionKind,
      reportedAt: now,
      updatedAt: now,
      deletedAt: null,
      expiresAt,
    },
  });

  return { ok: true, value: { siteId } };
}

export async function getActiveShelterPostsForDevice(deviceId: string): Promise<
  Array<{
    siteId: string;
    siteName: string;
    conditionKind: SiteConditionKindLower;
    comment: string | null;
    reportedAt: string;
    expiresAt: string;
  }>
> {
  const deviceHash = toDeviceHash(deviceId);
  if (!deviceHash) return [];
  return listActiveShelterPostsByDeviceHash(deviceHash);
}

export async function getShelterCommunitySnapshot(shelterId: string): Promise<ShelterCommunity> {
  const siteId = await resolveSiteId(shelterId, false);
  if (!siteId) return defaultShelterCommunity(shelterId);
  const rows = await readActiveSiteReports(siteId);
  return buildShelterCommunityFromReports(siteId, rows);
}

export function summarizeShelterCommunityForDevice(
  community: ShelterCommunity,
  admin: AdminState,
  deviceId?: string | null,
  options?: {
    window?: string;
    activePosts?: Array<{
      siteId: string;
      siteName: string;
      conditionKind: SiteConditionKindLower;
      comment: string | null;
      reportedAt: string;
      expiresAt: string;
    }>;
  }
) {
  const window = normalizeSummaryWindowKey(options?.window ?? '24h');
  const sinceMs = Date.now() - SHELTER_SUMMARY_WINDOW_MS[window];

  const filteredVotes = community.votes.filter((vote) => {
    const t = Date.parse(vote.createdAt);
    return Number.isFinite(t) && t >= sinceMs;
  });
  const filteredComments = community.comments.filter((comment) => {
    const t = Date.parse(comment.createdAt);
    return Number.isFinite(t) && t >= sinceMs;
  });

  const votesSummary: Record<SiteConditionKindLower, number> = {
    ok: 0,
    crowded: 0,
    very_crowded: 0,
    closed: 0,
    blocked: 0,
  };
  for (const vote of filteredVotes) {
    const key = normalizeSiteConditionKind(String(vote.value));
    votesSummary[key] += 1;
  }

  const contributorIds = new Set<string>();
  for (const vote of filteredVotes) contributorIds.add(vote.deviceId);
  for (const comment of filteredComments) contributorIds.add(comment.deviceId);

  const currentUserVoteRaw = deviceId ? community.votes.find((v) => v.deviceId === deviceId)?.value ?? null : null;
  const currentUserVote = currentUserVoteRaw ? normalizeSiteConditionKind(String(currentUserVoteRaw)) : null;

  const visibleComments = filteredComments.filter((c) => !c.hidden);
  const lastReportedAt =
    filteredVotes.length > 0
      ? filteredVotes
          .map((vote) => Date.parse(vote.createdAt))
          .filter((t) => Number.isFinite(t))
          .sort((a, b) => b - a)
          .map((t) => new Date(t).toISOString())[0] ?? null
      : null;

  const activePosts = options?.activePosts ?? [];

  return {
    ok: true,
    updatedAt: community.updatedAt,
    moderationPolicy: admin.moderationPolicy,
    votesSummary,
    totalVotes: filteredVotes.length,
    lastReportedAt,
    window,
    contributorCount: contributorIds.size,
    currentUserVote,
    commentCount: visibleComments.length,
    hiddenCount: 0,
    mostReported: 0,
    commentsCollapsed: false,
    comments: visibleComments.slice(0, 50),
    recentComments: visibleComments.slice(0, 5),
    activePostLimit: SHELTER_ACTIVE_POST_LIMIT,
    activePostCount: activePosts.length,
    activePosts,
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

  try {
    const persisted = await persistShelterStatusReport({
      shelterId: args.shelterId,
      deviceHash: toDeviceHash(args.deviceId),
      conditionKind: normalizeSiteConditionKind(String(args.value)),
      comment: sanitizeShelterComment(args.comment ?? null),
    });
    if (!persisted.ok) return persisted;
    const community = await getShelterCommunitySnapshot(persisted.value.siteId);
    return { ok: true, value: community };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[store:shelter] submit_vote_failed', { error: message });
    return { ok: false, code: 'BAD_REQUEST', message: 'Vote could not be persisted.' };
  }
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

  const safeText = sanitizeShelterComment(args.text);
  if (!safeText) return { ok: false, code: 'BAD_REQUEST', message: 'Comment is empty.' };

  try {
    const siteId = await resolveSiteId(args.shelterId, true);
    if (!siteId) return { ok: false, code: 'BAD_REQUEST', message: 'Shelter not found or inactive.' };

    const existing = await prisma.siteStatusReport.findUnique({
      where: { siteId_deviceHash: { siteId, deviceHash: toDeviceHash(args.deviceId) } },
      select: { conditionKind: true },
    });
    const conditionKind = normalizeSiteConditionKind(existing?.conditionKind ?? 'ok');
    const persisted = await persistShelterStatusReport({
      shelterId: siteId,
      deviceHash: toDeviceHash(args.deviceId),
      conditionKind,
      comment: safeText,
    });
    if (!persisted.ok) return persisted;

    const community = await getShelterCommunitySnapshot(persisted.value.siteId);
    return { ok: true, value: community };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[store:shelter] submit_comment_failed', { error: message });
    return { ok: false, code: 'BAD_REQUEST', message: 'Comment could not be persisted.' };
  }
}

export async function deleteShelterVoteAndComment(args: {
  shelterId: string;
  deviceId: string;
}): Promise<StoreResult<ShelterCommunity>> {
  try {
    const siteId = await resolveSiteId(args.shelterId, false);
    if (!siteId) return { ok: true, value: defaultShelterCommunity(args.shelterId) };

    const now = new Date();
    await prisma.siteStatusReport.updateMany({
      where: {
        siteId,
        deviceHash: toDeviceHash(args.deviceId),
        deletedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        deletedAt: now,
        expiresAt: now,
        updatedAt: now,
      },
    });

    const community = await getShelterCommunitySnapshot(siteId);
    return { ok: true, value: community };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[store:shelter] delete_vote_failed', { error: message });
    return { ok: false, code: 'BAD_REQUEST', message: 'Vote could not be deleted.' };
  }
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
