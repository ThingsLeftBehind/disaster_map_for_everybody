import { z } from 'zod';
import { DeviceIdSchema, PrefCodeSchema } from 'lib/store/types';

export const PushCellSchema = z.object({
  cellId: z.string().min(4).max(32),
  prefCode: PrefCodeSchema.nullable().optional(),
  lastSeenAt: z.string().optional(),
});

export const PushRegisterSchema = z.object({
  deviceId: DeviceIdSchema,
  expoPushToken: z.string().min(10).max(255),
  subscribedCells: z.array(PushCellSchema).max(12),
  platform: z.string().max(20).optional(),
  appVersion: z.string().max(20).optional(),
  locale: z.string().max(20).optional(),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840).optional(),
});

export const PushUnregisterSchema = z.object({
  deviceId: DeviceIdSchema,
});

export type PushCell = z.infer<typeof PushCellSchema>;
export type PushRegisterBody = z.infer<typeof PushRegisterSchema>;
export type PushUnregisterBody = z.infer<typeof PushUnregisterSchema>;
