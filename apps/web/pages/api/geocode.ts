import { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';

const querySchema = z.object({ q: z.string().min(1) });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'missing_query' });
    return;
  }
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(parsed.data.q)}&countrycodes=jp&limit=5`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'jp-evacuation-finder'
    }
  });
  if (!response.ok) {
    res.status(502).json({ error: 'geocode_failed' });
    return;
  }
  const results = await response.json();
  res.json({
    results: results.map((item: any) => ({
      label: item.display_name as string,
      lat: Number(item.lat),
      lng: Number(item.lon)
    }))
  });
}
