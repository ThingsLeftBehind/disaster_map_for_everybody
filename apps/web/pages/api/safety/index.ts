import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/prisma';
import { ensureDevice } from '../../../lib/device';
import { safetySchema } from '@jp-evac/shared';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const device = await ensureDevice(req, res);
  if (req.method === 'GET') {
    const status = await prisma.safetyStatus.findUnique({
      where: { deviceId: device.id },
      include: { currentSite: true }
    });
    res.json({
      device_hash: device.deviceHash,
      transfer_code: device.transferCode,
      safety_status: status
        ? {
            status: status.status,
            current_site_id: status.currentSiteId,
            current_site_name: status.currentSite?.name,
            updated_at: status.updatedAt
          }
        : null
    });
    return;
  }
  if (req.method === 'POST') {
    const parsed = safetySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input' });
      return;
    }
    const currentSite = parsed.data.current_site_id
      ? await prisma.evacSite.findUnique({ where: { id: parsed.data.current_site_id } })
      : null;
    await prisma.safetyStatus.upsert({
      where: { deviceId: device.id },
      create: {
        deviceId: device.id,
        status: parsed.data.status,
        currentSiteId: currentSite ? currentSite.id : null
      },
      update: {
        status: parsed.data.status,
        currentSiteId: currentSite ? currentSite.id : null,
        updatedAt: new Date()
      }
    });
    res.status(201).json({ status: 'updated' });
    return;
  }
  res.status(405).end();
}
