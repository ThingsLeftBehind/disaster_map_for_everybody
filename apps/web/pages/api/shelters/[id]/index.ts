import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../lib/prisma';
import { summarizeReports } from '../../../../lib/status';
import { subMinutes } from 'date-fns';
import { z } from 'zod';

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
  const { id } = parsed.data;
  const site = await prisma.evacSite.findUnique({
    where: { id },
    include: { hazardCapabilities: true }
  });
  if (!site) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const reports = await prisma.siteStatusReport.findMany({
    where: { siteId: id, reportedAt: { gte: subMinutes(new Date(), 60) } },
    orderBy: { reportedAt: 'desc' },
    take: 50
  });
  const summary = summarizeReports(reports);
  res.json({
    id: site.id,
    name: site.name,
    address: site.address,
    lat: site.latitude,
    lng: site.longitude,
    kind: site.kind,
    capacity: site.capacity,
    is_designated: site.isDesignated,
    municipality_code: site.municipalityCode,
    source_name: site.sourceName,
    source_url: site.sourceUrl,
    hazard_capabilities: site.hazardCapabilities.map((h) => ({
      hazard_type: h.hazardType,
      is_supported: h.isSupported,
      remark: h.remark
    })),
    status_summary: summary
  });
}
