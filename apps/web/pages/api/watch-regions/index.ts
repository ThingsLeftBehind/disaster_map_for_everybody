import { NextApiRequest, NextApiResponse } from 'next';
import { ensureDevice } from '../../../lib/device';
import { prisma } from '../../../lib/prisma';
import { hazardKeys, watchRegionSchema } from '@jp-evac/shared';

async function listRegions(deviceId: string) {
  const regions = await prisma.watchRegion.findMany({
    where: { deviceId },
    include: { hazards: true },
    orderBy: { createdAt: 'asc' }
  });
  return regions.map((region) => ({
    id: region.id,
    label: region.label,
    latitude: region.latitude,
    longitude: region.longitude,
    radius_km: region.radiusKm,
    active: region.active,
    hazard_types: region.hazards.filter((h) => h.active).map((h) => h.hazardType),
    updated_at: region.updatedAt
  }));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const device = await ensureDevice(req, res);
  if (req.method === 'GET') {
    const regions = await listRegions(device.id);
    res.json({ regions });
    return;
  }
  if (req.method === 'POST') {
    const parsed = watchRegionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input' });
      return;
    }
    const hazardTypes = parsed.data.hazard_types?.length ? parsed.data.hazard_types : hazardKeys;
    if (parsed.data.id) {
      const existing = await prisma.watchRegion.findFirst({ where: { id: parsed.data.id, deviceId: device.id } });
      if (!existing) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      await prisma.watchRegion.update({
        where: { id: existing.id },
        data: {
          label: parsed.data.label,
          latitude: parsed.data.latitude,
          longitude: parsed.data.longitude,
          radiusKm: parsed.data.radius_km,
          active: parsed.data.active
        }
      });
      await prisma.watchRegionHazard.deleteMany({ where: { regionId: existing.id } });
      await prisma.watchRegionHazard.createMany({
        data: hazardTypes.map((hazardType) => ({ regionId: existing.id, hazardType, active: true })),
        skipDuplicates: true
      });
    } else {
      const region = await prisma.watchRegion.create({
        data: {
          deviceId: device.id,
          label: parsed.data.label,
          latitude: parsed.data.latitude,
          longitude: parsed.data.longitude,
          radiusKm: parsed.data.radius_km,
          active: parsed.data.active,
          hazards: {
            create: hazardTypes.map((hazardType) => ({ hazardType }))
          }
        }
      });
      await prisma.watchRegion.update({ where: { id: region.id }, data: {} });
    }
    const regions = await listRegions(device.id);
    res.status(201).json({ regions });
    return;
  }
  res.status(405).end();
}
