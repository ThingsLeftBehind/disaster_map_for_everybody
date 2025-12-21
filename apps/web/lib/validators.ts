import { z } from 'zod';
import { hazardKeys } from '@jp-evac/shared';
import { DEFAULT_MAIN_LIMIT } from './constants';

export const NearbyQuerySchema = z.object({
  lat: z.preprocess((v) => Number(v), z.number().finite().min(-90).max(90)),
  lon: z.preprocess((v) => Number(v), z.number().finite().min(-180).max(180)),
  q: z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().min(1).max(80)).optional(),
  hazardTypes: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) return [] as string[];
      if (Array.isArray(value)) return value;
      return value.split(',').filter(Boolean);
    })
    .transform((values) => values.filter((v) => hazardKeys.includes(v as any))),
  limit: z.preprocess((v) => (v ? Number(v) : DEFAULT_MAIN_LIMIT), z.number().min(1).max(50)).optional(),
  radiusKm: z.preprocess((v) => (v ? Number(v) : 30), z.number().min(1).max(50)).optional(),
  hideIneligible: z
    .preprocess((v) => (v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : false), z.boolean())
    .optional(),
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
  last_known_lat: z.number().min(-90).max(90).optional(),
  last_known_lon: z.number().min(-180).max(180).optional(),
  saved_places: z.any().optional(),
  hazard_alert_prefs: z.any().optional(),
});
