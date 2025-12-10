import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@jp-evac/db';
import { CrowdReportSchema } from '../../lib/validators';

const MINUTES_BETWEEN_REPORTS = 2;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const parsed = CrowdReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  const { siteId, status, comment, device_hash } = parsed.data;

  const recentReport = await prisma.crowd_reports.findFirst({
    where: {
      device_hash,
      created_at: {
        gte: new Date(Date.now() - MINUTES_BETWEEN_REPORTS * 60 * 1000),
      },
    },
  });

  if (recentReport) {
    return res.status(429).json({ error: 'Please wait before submitting another report.' });
  }

  const created = await prisma.crowd_reports.create({
    data: {
      siteId,
      status,
      comment,
      device_hash,
    },
  });

  res.status(200).json({ report: created });
}
