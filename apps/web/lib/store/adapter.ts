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

type SafetyStateDb = 'safe' | 'serious_injury' | 'isolated' | 'evacuating' | 'evacuated';
type SafetyStatusPublic = 'SAFE' | 'INJURED' | 'ISOLATED' | 'EVACUATING' | 'COMPLETED';

function normalizeSafetyState(value: string): SafetyStateDb {
  const status = String(value ?? '').trim().toLowerCase();
  if (status === 'safe') return 'safe';
  if (status === 'serious_injury' || status === 'injured') return 'serious_injury';
  if (status === 'isolated') return 'isolated';
  if (status === 'evacuating') return 'evacuating';
  if (status === 'evacuated' || status === 'completed') return 'evacuated';
  return 'safe';
}

function toPublicSafetyStatus(state: SafetyStateDb | string): SafetyStatusPublic {
  const normalized = normalizeSafetyState(String(state ?? ''));
  if (normalized === 'serious_injury') return 'INJURED';
  if (normalized === 'isolated') return 'ISOLATED';
  if (normalized === 'evacuating') return 'EVACUATING';
  if (normalized === 'evacuated') return 'COMPLETED';
  return 'SAFE';
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

function sanitizeSafetyMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const noTags = value.replace(/<[^>]*>/g, ' ');
  const noUrls = noTags.replace(/(?:https?:\/\/|www\.)\S+/gi, ' ');
  const text = noUrls.replace(/\s+/g, ' ').trim().slice(0, 140);
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
    sanitizeSafetyMessage(previous.comment) === sanitizeSafetyMessage(next.comment) &&
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

const SAFETY_STATUS_TTL_MS = 72 * 60 * 60 * 1000;
const SAFETY_PUBLIC_WINDOW_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '3d': 72 * 60 * 60 * 1000,
} as const;
type SafetyWindowKey = keyof typeof SAFETY_PUBLIC_WINDOW_MS;

function toSafetyWindowKey(value: string | null | undefined): SafetyWindowKey {
  return value === '3d' ? '3d' : '24h';
}

function toSafetyDeviceHash(deviceId: string): string {
  return deviceId.trim();
}

function resolveSafetyStateFromFilter(value: string): SafetyStateDb | null {
  const status = String(value ?? '').trim();
  if (!status) return null;
  const upper = status.toUpperCase();
  if (upper === 'SAFE') return 'safe';
  if (upper === 'INJURED') return 'serious_injury';
  if (upper === 'ISOLATED') return 'isolated';
  if (upper === 'EVACUATING') return 'evacuating';
  if (upper === 'COMPLETED' || upper === 'EVACUATED') return 'evacuated';
  if (upper === 'SERIOUS_INJURY') return 'serious_injury';
  return null;
}

function coarsenPublicCoords(lat: number, lon: number): { displayLat: number; displayLon: number } {
  const latStep = 0.0036;
  const cosLat = Math.max(0.35, Math.cos((lat * Math.PI) / 180));
  const lonStep = latStep / cosLat;
  const latBucket = Math.floor(lat / latStep);
  const lonBucket = Math.floor(lon / lonStep);
  const displayLat = Number(((latBucket + 0.5) * latStep).toFixed(6));
  const displayLon = Number(((lonBucket + 0.5) * lonStep).toFixed(6));
  return { displayLat, displayLon };
}

async function resolveOrCreateDeviceByHash(deviceHash: string): Promise<{ id: string; deviceHash: string }> {
  const existing = await prisma.device.findUnique({
    where: { deviceHash },
    select: { id: true, deviceHash: true },
  });
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
    const raced = await prisma.device.findUnique({
      where: { deviceHash },
      select: { id: true, deviceHash: true },
    });
    if (!raced) throw error;
    return raced;
  }
}

async function readActiveSafetyStatusRow(deviceHash: string): Promise<{
  id: string;
  status: SafetyStateDb;
  lastKnownLat: number | null;
  lastKnownLon: number | null;
  locationAccuracyM: number | null;
  message: string | null;
  messagePublic: boolean;
  updatedAt: Date;
  expiresAt: Date;
} | null> {
  const device = await prisma.device.findUnique({
    where: { deviceHash },
    select: { id: true },
  });
  if (!device) return null;

  const now = new Date();
  const row = await prisma.safetyStatus.findFirst({
    where: {
      deviceId: device.id,
      deletedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      status: true,
      lastKnownLat: true,
      lastKnownLon: true,
      locationAccuracyM: true,
      message: true,
      messagePublic: true,
      updatedAt: true,
      expiresAt: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    status: normalizeSafetyState(String(row.status)),
    lastKnownLat: typeof row.lastKnownLat === 'number' ? row.lastKnownLat : null,
    lastKnownLon: typeof row.lastKnownLon === 'number' ? row.lastKnownLon : null,
    locationAccuracyM: typeof row.locationAccuracyM === 'number' ? row.locationAccuracyM : null,
    message: sanitizeSafetyMessage(row.message),
    messagePublic: Boolean(row.messagePublic),
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  };
}

async function upsertDbSafetyStatus(args: {
  deviceHash: string;
  status: SafetyStateDb;
  lat: number;
  lon: number;
  locationAccuracyM: number | null;
  message: string | null;
  messagePublic: boolean;
}): Promise<void> {
  const device = await resolveOrCreateDeviceByHash(args.deviceHash);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SAFETY_STATUS_TTL_MS);

  await prisma.$transaction([
    prisma.device.update({
      where: { id: device.id },
      data: { updatedAt: now },
    }),
    prisma.safetyStatus.upsert({
      where: { deviceId: device.id },
      create: {
        id: crypto.randomUUID(),
        deviceId: device.id,
        status: args.status,
        lastKnownLat: args.lat,
        lastKnownLon: args.lon,
        locationAccuracyM: args.locationAccuracyM,
        message: args.message,
        messagePublic: args.messagePublic,
        deletedAt: null,
        expiresAt,
        updatedAt: now,
      },
      update: {
        status: args.status,
        lastKnownLat: args.lat,
        lastKnownLon: args.lon,
        locationAccuracyM: args.locationAccuracyM,
        message: args.message,
        messagePublic: args.messagePublic,
        deletedAt: null,
        expiresAt,
        updatedAt: now,
      },
    }),
  ]);
}

async function listDbSafetyPins(args: {
  window: SafetyWindowKey;
  statuses?: string[] | null | undefined;
}): Promise<{
  updatedAt: string | null;
  pins: Array<{
    id: string;
    status: string;
    displayLat: number;
    displayLon: number;
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
  const now = new Date();
  const windowStart = new Date(now.getTime() - SAFETY_PUBLIC_WINDOW_MS[args.window]);
  const dbStatuses = Array.from(new Set((args.statuses ?? []).map(resolveSafetyStateFromFilter).filter(Boolean))) as SafetyStateDb[];

  const rows = await prisma.safetyStatus.findMany({
    where: {
      deletedAt: null,
      expiresAt: { gt: now },
      updatedAt: { gte: windowStart },
      ...(dbStatuses.length > 0 ? { status: { in: dbStatuses as any[] } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 500,
    select: {
      id: true,
      status: true,
      lastKnownLat: true,
      lastKnownLon: true,
      message: true,
      messagePublic: true,
      updatedAt: true,
      Device: { select: { deviceHash: true } },
    },
  });

  const pins = rows
    .map((row) => {
      if (typeof row.lastKnownLat !== 'number' || typeof row.lastKnownLon !== 'number') return null;
      const display = coarsenPublicCoords(row.lastKnownLat, row.lastKnownLon);
      const publicMessage = row.messagePublic ? sanitizeSafetyMessage(row.message) : null;
      return {
        id: pinPublicId(row.Device?.deviceHash ?? row.id, row.id),
        status: toPublicSafetyStatus(normalizeSafetyState(String(row.status))),
        displayLat: display.displayLat,
        displayLon: display.displayLon,
        lat: display.displayLat,
        lon: display.displayLon,
        precision: 'COARSE' as CheckinPrecision,
        comment: publicMessage,
        updatedAt: row.updatedAt.toISOString(),
        archived: false,
        archivedAt: null,
        reportCount: 0,
        commentHidden: false,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return {
    updatedAt: pins[0]?.updatedAt ?? null,
    pins,
  };
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
  const base = parsed.success ? parsed.data : defaultDeviceState(deviceId);
  if (!parsed.success && !requiresDbPersistence()) {
    await atomicWriteJson(localStoreDevicePath(deviceId), base);
  }

  try {
    const active = await readActiveSafetyStatusRow(toSafetyDeviceHash(deviceId));
    const checkins = active
      ? [
          {
            id: active.id,
            status: toPublicSafetyStatus(active.status),
            shelterId: null,
            updatedAt: active.updatedAt.toISOString(),
            lat: active.lastKnownLat,
            lon: active.lastKnownLon,
            locationAccuracyM: active.locationAccuracyM,
            messagePublic: active.messagePublic,
            expiresAt: active.expiresAt.toISOString(),
            deletedAt: null,
            precision: active.locationAccuracyM !== null && active.locationAccuracyM <= 50 ? 'PRECISE' : 'COARSE',
            comment: active.message,
            active: true,
            archivedAt: null,
          },
        ]
      : [];
    return {
      ...base,
      checkins,
      updatedAt: active ? active.updatedAt.toISOString() : base.updatedAt,
    };
  } catch (error) {
    if (requiresDbPersistence()) throw error;
    return base;
  }
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
  const now = new Date();
  const deviceHash = toSafetyDeviceHash(deviceId);

  try {
    const device = await prisma.device.findUnique({
      where: { deviceHash },
      select: { id: true },
    });
    if (device) {
      await prisma.safetyStatus.updateMany({
        where: {
          deviceId: device.id,
          deletedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          deletedAt: now,
          expiresAt: now,
          updatedAt: now,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[store:safety] db_clear_failed', { error: message });
    if (requiresDbPersistence()) throw error;
  }

  if (!requiresDbPersistence()) {
    const at = now.toISOString();
    await runExclusive(`device:${deviceId}`, async () => {
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
  }

  return getDeviceState(deviceId);
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

  const comment = sanitizeSafetyMessage(entry.comment);
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
  locationAccuracyM?: number | null | undefined;
  messagePublic?: boolean | null | undefined;
  precision: CheckinPrecision;
  comment: string | null | undefined;
}): Promise<StoreResult<DeviceState>> {
  const rlIp = checkRateLimit(`checkin:ip:${args.ipHash}`, 60, 60_000);
  if (!rlIp.ok) return { ok: false, code: 'RATE_LIMITED', message: 'Too many check-ins (ip)' };
  const rlDevice = checkRateLimit(`checkin:dev:${args.deviceId}`, 20, 60_000);
  if (!rlDevice.ok) return { ok: false, code: 'RATE_LIMITED', message: 'Too many check-ins (device)' };
  const status = normalizeSafetyState(args.status);
  const message = sanitizeSafetyMessage(args.comment);
  const locationAccuracyM = typeof args.locationAccuracyM === 'number' && Number.isFinite(args.locationAccuracyM) ? args.locationAccuracyM : null;
  const messagePublic = Boolean(args.messagePublic);

  try {
    await upsertDbSafetyStatus({
      deviceHash: toSafetyDeviceHash(args.deviceId),
      status,
      lat: args.lat,
      lon: args.lon,
      locationAccuracyM,
      message,
      messagePublic,
    });
    const device = await getDeviceState(args.deviceId);
    return { ok: true, value: device };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    console.warn('[store:safety] submit_failed', { error: messageText });
    if (requiresDbPersistence()) {
      return { ok: false, code: 'BAD_REQUEST', message: 'Safety status could not be persisted.' };
    }

    const { value } = await runExclusive(`device:${args.deviceId}`, async () => {
      const current = await getDeviceState(args.deviceId);
      const next = buildNextDeviceStateWithCheckin(current, {
        status: toPublicSafetyStatus(status),
        shelterId: args.shelterId ?? null,
        lat: args.lat,
        lon: args.lon,
        precision: args.precision,
        comment: message,
      });
      await atomicWriteJson(localStoreDevicePath(args.deviceId), next);
      return next;
    });
    if (!value) return { ok: false, code: 'BAD_REQUEST', message: 'Safety status could not be persisted.' };
    return { ok: true, value };
  }
}

export async function listCheckinPins(args: {
  window?: string | null | undefined;
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
  const window = toSafetyWindowKey(args.window ?? undefined);

  try {
    const [reportsState, dbData] = await Promise.all([
      getCheckinReportsState(),
      listDbSafetyPins({ window, statuses: args.statuses }),
    ]);

    const pins = dbData.pins.map((pin) => {
      const reportMeta = reportsState.pins?.[pin.id] ?? null;
      const reportCount = typeof reportMeta?.reportCount === 'number' ? reportMeta.reportCount : 0;
      const commentHidden = Boolean(reportMeta?.commentHidden);
      return {
        ...pin,
        reportCount,
        commentHidden,
      };
    });

    return {
      updatedAt: dbData.updatedAt,
      pins,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[store:safety] list_failed', { error: message });
    if (requiresDbPersistence()) throw error;
    return {
      updatedAt: null,
      pins: [],
    };
  }
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
