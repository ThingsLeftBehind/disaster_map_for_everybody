import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@jp-evac/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const siteId = req.query.siteId as string;
  if (!siteId) {
    return res.status(400).json({ error: 'siteId is required' });
  }

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const reports = await prisma.crowd_reports.findMany({
    where: { site_id: siteId, created_at: { gte: since } },
  });

  const summary = reports.reduce<Record<string, number>>((acc, report) => {
    acc[report.status] = (acc[report.status] || 0) + 1;
    return acc;
  }, {});

  res.status(200).json({ summary, count: reports.length });
}
