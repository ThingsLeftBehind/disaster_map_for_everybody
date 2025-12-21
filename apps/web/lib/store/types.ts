import { z } from 'zod';

export const DeviceIdSchema = z.string().min(6).max(80);
export type DeviceId = z.infer<typeof DeviceIdSchema>;

export const PrefCodeSchema = z.string().regex(/^\d{2}$/);
export const MuniCodeSchema = z.string().regex(/^\d{6}$/);
export const JmaAreaCodeSchema = z.string().regex(/^\d{6}$/);

export const SavedAreaSchema = z.object({
  id: z.string().min(6).max(80),
  label: z.string().max(40).nullable().optional(),
  prefCode: PrefCodeSchema,
  prefName: z.string().min(1).max(40),
  muniCode: MuniCodeSchema.nullable().optional(),
  muniName: z.string().max(80).nullable().optional(),
  jmaAreaCode: JmaAreaCodeSchema.nullable().optional(),
  addedAt: z.string(),
});
export type SavedArea = z.infer<typeof SavedAreaSchema>;

export const SettingsSchema = z.object({
  powerSaving: z.boolean().default(false),
  lowBandwidth: z.boolean().default(false),
  selectedAreaId: z.string().nullable().default(null),
  includePreciseShareLocation: z.boolean().default(false),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const CheckinStatusSchema = z.enum(['INJURED', 'SAFE', 'ISOLATED', 'EVACUATING', 'COMPLETED']);
export type CheckinStatus = z.infer<typeof CheckinStatusSchema>;

export const CheckinPrecisionSchema = z.enum(['COARSE', 'PRECISE']);
export type CheckinPrecision = z.infer<typeof CheckinPrecisionSchema>;

export const CheckinEntrySchema = z.object({
  id: z.string().min(6),
  status: CheckinStatusSchema,
  shelterId: z.string().nullable().optional(),
  updatedAt: z.string(),
  lat: z.number().min(-90).max(90).finite().nullable().optional(),
  lon: z.number().min(-180).max(180).finite().nullable().optional(),
  precision: CheckinPrecisionSchema.optional(),
  comment: z.string().max(120).nullable().optional(),
  active: z.boolean().optional(),
  archivedAt: z.string().nullable().optional(),
});
export type CheckinEntry = z.infer<typeof CheckinEntrySchema>;

export const DeviceStateSchema = z.object({
  version: z.literal(1),
  deviceId: DeviceIdSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: SettingsSchema,
  savedAreas: z.array(SavedAreaSchema),
  favorites: z.object({
    shelterIds: z.array(z.string()),
  }),
  recent: z.object({
    shelterIds: z.array(z.string()),
  }),
  checkins: z.array(CheckinEntrySchema),
});
export type DeviceState = z.infer<typeof DeviceStateSchema>;

export const CrowdVoteValueSchema = z.enum(['EVACUATING', 'SMOOTH', 'NORMAL', 'CROWDED', 'CLOSED']);
export type CrowdVoteValue = z.infer<typeof CrowdVoteValueSchema>;

export const ShelterVoteSchema = z.object({
  id: z.string().min(6),
  deviceId: DeviceIdSchema,
  ipHash: z.string().min(8).max(80),
  value: CrowdVoteValueSchema,
  createdAt: z.string(),
});
export type ShelterVote = z.infer<typeof ShelterVoteSchema>;

export const ShelterCommentSchema = z.object({
  id: z.string().min(6),
  deviceId: DeviceIdSchema,
  ipHash: z.string().min(8).max(80),
  text: z.string().min(1).max(500),
  createdAt: z.string(),
  hidden: z.boolean().default(false),
  reportCount: z.number().int().min(0).default(0),
});
export type ShelterComment = z.infer<typeof ShelterCommentSchema>;

export const ShelterReportSchema = z.object({
  id: z.string().min(6),
  commentId: z.string().min(6),
  deviceId: DeviceIdSchema,
  ipHash: z.string().min(8).max(80),
  reason: z.string().max(200).nullable().optional(),
  createdAt: z.string(),
});
export type ShelterReport = z.infer<typeof ShelterReportSchema>;

export const ShelterCommunitySchema = z.object({
  version: z.literal(1),
  shelterId: z.string().min(1),
  updatedAt: z.string(),
  votes: z.array(ShelterVoteSchema),
  comments: z.array(ShelterCommentSchema),
  reports: z.array(ShelterReportSchema),
});
export type ShelterCommunity = z.infer<typeof ShelterCommunitySchema>;

export const ModerationPolicySchema = z.object({
  reportCautionThreshold: z.number().int().min(1).max(50),
  reportHideThreshold: z.number().int().min(1).max(50),
});
export type ModerationPolicy = z.infer<typeof ModerationPolicySchema>;

export const AdminStateSchema = z.object({
  version: z.literal(1),
  banner: z.object({
    text: z.string().max(500).nullable(),
    updatedAt: z.string().nullable(),
  }),
  moderationPolicy: ModerationPolicySchema,
});
export type AdminState = z.infer<typeof AdminStateSchema>;

export const ModerationQueueEntrySchema = z.object({
  id: z.string().min(6),
  shelterId: z.string(),
  commentId: z.string(),
  reportCount: z.number().int().min(0),
  createdAt: z.string(),
});
export type ModerationQueueEntry = z.infer<typeof ModerationQueueEntrySchema>;

export const ModerationStateSchema = z.object({
  version: z.literal(1),
  queue: z.array(ModerationQueueEntrySchema),
  updatedAt: z.string().nullable(),
});
export type ModerationState = z.infer<typeof ModerationStateSchema>;

export const StoreErrorCodeSchema = z.enum(['RATE_LIMITED', 'DUPLICATE', 'NOT_FOUND', 'BAD_REQUEST', 'FORBIDDEN']);
export type StoreErrorCode = z.infer<typeof StoreErrorCodeSchema>;

export type StoreResult<T> = { ok: true; value: T } | { ok: false; code: StoreErrorCode; message: string };

export const UpdateDeviceBodySchema = z.object({
  deviceId: DeviceIdSchema,
  settings: SettingsSchema.partial().optional(),
  savedAreas: z.array(SavedAreaSchema).optional(),
  favorites: z.object({ shelterIds: z.array(z.string()) }).partial().optional(),
  recent: z.object({ shelterIds: z.array(z.string()) }).partial().optional(),
});

export const CheckinBodySchema = z.object({
  deviceId: DeviceIdSchema,
  status: CheckinStatusSchema,
  shelterId: z.string().nullable().optional(),
  lat: z.preprocess((v) => Number(v), z.number().min(-90).max(90).finite()),
  lon: z.preprocess((v) => Number(v), z.number().min(-180).max(180).finite()),
  precision: CheckinPrecisionSchema.optional(),
  comment: z.string().max(120).nullable().optional(),
});

export const ShelterVoteBodySchema = z.object({
  shelterId: z.string().min(1),
  deviceId: DeviceIdSchema,
  value: CrowdVoteValueSchema,
});

export const ShelterCommentBodySchema = z.object({
  shelterId: z.string().min(1),
  deviceId: DeviceIdSchema,
  text: z.string().min(1).max(500),
});

export const ShelterReportBodySchema = z.object({
  shelterId: z.string().min(1),
  deviceId: DeviceIdSchema,
  commentId: z.string().min(6),
  reason: z.string().max(200).nullable().optional(),
});

export const TransferExportBodySchema = z.object({
  deviceId: DeviceIdSchema,
});

export const TransferImportBodySchema = z.object({
  deviceId: DeviceIdSchema,
  code: z.string().min(10).max(10_000),
});

export const AdminBannerUpdateBodySchema = z.object({
  text: z.string().max(500).nullable(),
});

export const AdminModerationActionBodySchema = z.object({
  action: z.enum(['HIDE_COMMENT', 'UNHIDE_COMMENT', 'DELETE_FROM_QUEUE']),
  shelterId: z.string(),
  commentId: z.string(),
});

export const CheckinReportBodySchema = z.object({
  deviceId: DeviceIdSchema,
  pinId: z.string().min(8).max(80),
  reason: z.string().max(200).nullable().optional(),
});

export const CheckinReportEntrySchema = z.object({
  id: z.string().min(6),
  pinId: z.string().min(8),
  deviceId: DeviceIdSchema,
  ipHash: z.string().min(8).max(80),
  reason: z.string().max(200).nullable().optional(),
  createdAt: z.string(),
});

export const CheckinReportsStateSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().nullable(),
  pins: z.record(
    z.object({
      reportCount: z.number().int().min(0),
      commentHidden: z.boolean().default(false),
    })
  ),
  reports: z.array(CheckinReportEntrySchema),
});
export type CheckinReportsState = z.infer<typeof CheckinReportsStateSchema>;
