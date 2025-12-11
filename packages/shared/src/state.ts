import { z } from 'zod';
import { hazardKeys, HazardKey } from './hazards';

export const congestionLevels = ['low', 'normal', 'high'] as const;
export type CongestionLevel = (typeof congestionLevels)[number];

export const accessibilityLevels = ['accessible', 'blocked', 'unknown'] as const;
export type AccessibilityLevel = (typeof accessibilityLevels)[number];

export const safetyStatuses = ['safe', 'minor_injury', 'serious_injury', 'isolated', 'evacuating', 'evacuated'] as const;
export type SafetyStatus = (typeof safetyStatuses)[number];

export const siteKinds = ['shelter', 'space', 'other'] as const;
export type SiteKind = (typeof siteKinds)[number];

export const hazardTypeArray: HazardKey[] = [...hazardKeys];

export const statusReportSchema = z.object({
  congestion_level: z.enum(congestionLevels),
  accessibility: z.enum(accessibilityLevels),
  comment: z.string().trim().max(240).optional()
});

export const safetySchema = z.object({
  status: z.enum(safetyStatuses),
  current_site_id: z.string().uuid().optional()
});

export const watchRegionSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(80),
  latitude: z.number(),
  longitude: z.number(),
  radius_km: z.number().positive().max(50),
  active: z.boolean(),
  hazard_types: z.array(z.enum(hazardKeys as [HazardKey, ...HazardKey[]])).optional()
});

export type StatusReportInput = z.infer<typeof statusReportSchema>;
export type SafetyInput = z.infer<typeof safetySchema>;
export type WatchRegionInput = z.infer<typeof watchRegionSchema>;
