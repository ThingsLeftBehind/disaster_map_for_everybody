import { z } from 'zod';
import { hazardKeys } from '@jp-evac/shared';

export const NearbyQuerySchema = z.object({
  lat: z.preprocess((v) => Number(v), z.number().finite()),
  lon: z.preprocess((v) => Number(v), z.number().finite()),
  hazardTypes: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) return [] as string[];
      if (Array.isArray(value)) return value;
      return value.split(',').filter(Boolean);
    })
    .transform((values) => values.filter((v) => hazardKeys.includes(v as any))),
  limit: z.preprocess((v) => (v ? Number(v) : 10), z.number().min(1).max(50)).optional(),
});

export const CrowdReportSchema = z.object({
  siteId: z.string().min(1),
  status: z.enum(['OK', 'CROWDED', 'VERY_CROWDED', 'CLOSED', 'BLOCKED']),
  comment: z.string().max(500).optional(),
  device_hash: z.string().min(4),
});

export const SafetyUpdateSchema = z.object({
  status: z.enum(['SAFE', 'EVACUATING', 'EVACUATED', 'INJURED', 'ISOLATED']),
  device_hash: z.string().min(4),
  last_known_lat: z.number().optional(),
  last_known_lon: z.number().optional(),
  saved_places: z.any().optional(),
  hazard_alert_prefs: z.any().optional(),
});
