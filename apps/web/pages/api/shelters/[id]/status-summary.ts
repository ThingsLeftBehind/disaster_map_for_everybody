import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../lib/prisma';
import { summarizeReports } from '../../../../lib/status';
import { z } from 'zod';
import { subMinutes } from 'date-fns';

const paramsSchema = z.object({ id: z.string().uuid() });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }
  const parsed = paramsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const reports = await prisma.siteStatusReport.findMany({
    where: { siteId: parsed.data.id, reportedAt: { gte: subMinutes(new Date(), 60) } },
    orderBy: { reportedAt: 'desc' },
    take: 100
  });
  const summary = summarizeReports(reports);
  res.json({ summary });
}
