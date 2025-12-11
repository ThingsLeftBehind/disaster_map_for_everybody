import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../lib/prisma';
import { ensureDevice } from '../../../../lib/device';
import { statusReportSchema } from '@jp-evac/shared';
import { z } from 'zod';
import { subMinutes } from 'date-fns';

const paramsSchema = z.object({ id: z.string().uuid() });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }
  const params = paramsSchema.safeParse(req.query);
  const body = statusReportSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const device = await ensureDevice(req, res);
  const siteId = params.data.id;
  const recent = await prisma.siteStatusReport.findFirst({
    where: { siteId, deviceHash: device.deviceHash, reportedAt: { gte: subMinutes(new Date(), 2) } },
    orderBy: { reportedAt: 'desc' }
  });
  if (recent) {
    res.status(429).json({ error: 'rate_limited' });
    return;
  }
  await prisma.siteStatusReport.create({
    data: {
      siteId,
      deviceHash: device.deviceHash,
      deviceId: device.id,
      congestionLevel: body.data.congestion_level,
      accessibility: body.data.accessibility,
      comment: body.data.comment
    }
  });
  res.status(201).json({ status: 'ok' });
}
