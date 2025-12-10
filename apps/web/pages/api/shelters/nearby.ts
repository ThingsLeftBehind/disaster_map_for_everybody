import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@jp-evac/db';
import { NearbyQuerySchema } from '../../../lib/validators';
import { haversineDistance } from '@jp-evac/shared';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const parsed = NearbyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() });
  }

  const { lat, lon, hazardTypes, limit } = parsed.data;
  const hazardFilters = hazardTypes ?? [];

  const sites = await prisma.evac_sites.findMany();
  const enriched = sites
    .map((site) => {
      const distance = haversineDistance(lat, lon, site.lat, site.lon);
      return { ...site, distance };
    })
    .filter((site) => {
      if (!hazardFilters || hazardFilters.length === 0) return true;
      const flags = site.hazards as Record<string, boolean>;
      return hazardFilters.every((key) => flags?.[key]);
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit ?? 10);

  res.status(200).json({ sites: enriched });
}
