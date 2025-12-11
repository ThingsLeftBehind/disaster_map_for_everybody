import { NextApiRequest, NextApiResponse } from 'next';
import { ensureDevice } from '../../../lib/device';
import { hazardKeys } from '@jp-evac/shared';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';

const querySchema = z.object({
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  hazardTypes: z.string().optional()
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query' });
    return;
  }
  const device = await ensureDevice(req, res);
  const hazardTypes = parsed.data.hazardTypes
    ?.split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const hazards = hazardTypes?.length ? hazardTypes : hazardKeys;
  const watchRegions = await prisma.watchRegion.findMany({
    where: { deviceId: device.id, active: true },
    include: { hazards: true }
  });
  res.json({
    location_risk: hazards.map((hazard) => ({ hazard_type: hazard, risk: 'unknown' })),
    watch_regions: watchRegions.map((region) => ({
      id: region.id,
      label: region.label,
      hazard_types: region.hazards.filter((h) => h.active).map((h) => h.hazardType),
      risk: 'pending'
    }))
  });
}
