import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
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
    const current = await getDeviceState(args.deviceId);
    const last = current.checkins?.find((c: any) => c && typeof c === 'object' && (c as any).active !== false) as any;
    if (last?.updatedAt && withinWindow(String(last.updatedAt), 15_000)) return null;

    const next = buildNextDeviceStateWithCheckin(current, {
      status: args.status,
      shelterId: args.shelterId ?? null,
      lat: args.lat,
      lon: args.lon,
      precision: args.precision,
      comment: args.comment ?? null,
    });
    await atomicWriteJson(localStoreDevicePath(args.deviceId), next);
    return next;
  });

  if (!value) return { ok: false, code: 'DUPLICATE', message: 'Please wait a moment before updating again.' };
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

  const [reportsState] = await Promise.all([getCheckinReportsState()]);

  let files: string[] = [];
  try {
    files = (await fs.readdir(localStoreDevicesDir())).filter((f) => f.endsWith('.json'));
  } catch {
    files = [];
  }

  const pins: Array<{
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

    const anyExplicitActive = checkins.some((c: any) => c && typeof c === 'object' && (c as any).active === true);
    const normalized = checkins.map((c: any, idx: number) => {
      const active = anyExplicitActive ? (c as any).active === true : idx === 0;
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

  pins.sort((a, b) => {
    const ta = Date.parse(a.updatedAt);
    const tb = Date.parse(b.updatedAt);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });

  const updatedAt = pins.length > 0 ? pins[0].updatedAt : null;
  return { updatedAt, pins: pins.slice(0, 500) };
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
  return getShelterCommunity(shelterId);
}

export async function submitVote(args: {
  shelterId: string;
  deviceId: string;
  ipHash: string;
  value: CrowdVoteValue;
}): Promise<StoreResult<ShelterCommunity>> {
  const rlIp = checkRateLimit(`vote:ip:${args.ipHash}`, 40, 60_000);
  if (!rlIp.ok) return { ok: false, code: 'RATE_LIMITED', message: 'Too many votes (ip)' };
  const rlDevice = checkRateLimit(`vote:dev:${args.deviceId}`, 15, 60_000);
  if (!rlDevice.ok) return { ok: false, code: 'RATE_LIMITED', message: 'Too many votes (device)' };

  const { value } = await runExclusive(`shelter:${args.shelterId}`, async () => {
    const current = await getShelterCommunity(args.shelterId);
    const recent = current.votes.find((v) => v.deviceId === args.deviceId && withinWindow(v.createdAt, STORE_LIMITS.voteWindowMs));
    if (recent) return null;

    const next: ShelterCommunity = {
      ...current,
      updatedAt: nowIso(),
      votes: [
        { id: nanoid(10), deviceId: args.deviceId, ipHash: args.ipHash, value: args.value, createdAt: nowIso() },
        ...current.votes,
      ].slice(0, STORE_LIMITS.maxVotesHistoryPerShelter),
    };
    await writeShelterCommunity(next);
    return next;
  });

  if (!value) return { ok: false, code: 'DUPLICATE', message: 'Please wait before voting again for this shelter.' };
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
