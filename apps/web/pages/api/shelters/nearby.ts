import { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { boundingBox, haversineDistance } from '@jp-evac/shared';
import { prisma } from '../../../lib/prisma';
import { summarizeReports } from '../../../lib/status';
import { subMinutes } from 'date-fns';
import { HazardType } from '@prisma/client';

const querySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusKm: z.coerce.number().positive().max(30).default(5),
  limit: z.coerce.number().int().positive().max(50).default(20),
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
  const { lat, lng, radiusKm, limit, hazardTypes } = parsed.data;
  const hazardOptions = Object.values(HazardType);
  const hazardFilter = hazardTypes
    ?.split(',')
    .map((h) => h.trim())
    .filter((h): h is HazardType => hazardOptions.includes(h as HazardType));
  const bbox = boundingBox(lat, lng, radiusKm);
  const sites = await prisma.evacSite.findMany({
    where: {
      latitude: { gte: bbox.minLat, lte: bbox.maxLat },
      longitude: { gte: bbox.minLon, lte: bbox.maxLon },
      hazardCapabilities: hazardFilter?.length
        ? { some: { hazardType: { in: hazardFilter }, isSupported: true } }
        : undefined
    },
    include: { hazardCapabilities: true },
    take: limit * 3
  });
  const enriched = sites
    .map((site) => {
      const distance = haversineDistance(lat, lng, site.latitude, site.longitude);
      return { site, distance };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);

  const siteIds = enriched.map(({ site }) => site.id);
  const reports = siteIds.length
    ? await prisma.siteStatusReport.findMany({
        where: { siteId: { in: siteIds }, reportedAt: { gte: subMinutes(new Date(), 60) } },
        orderBy: { reportedAt: 'desc' }
      })
    : [];
  const reportMap = new Map<string, typeof reports>();
  for (const siteId of siteIds) {
    reportMap.set(siteId, []);
  }
  for (const report of reports) {
    const group = reportMap.get(report.siteId);
    if (group) group.push(report);
  }

  res.json({
    sites: enriched.map(({ site, distance }) => {
      const summary = summarizeReports(reportMap.get(site.id) ?? []);
      return {
        id: site.id,
        name: site.name,
        address: site.address,
        lat: site.latitude,
        lng: site.longitude,
        distance_km: distance,
        hazard_types: site.hazardCapabilities.filter((h) => h.isSupported).map((h) => h.hazardType),
        status_summary: summary
      };
    })
  });
}
