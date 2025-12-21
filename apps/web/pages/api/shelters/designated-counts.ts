import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma, prisma } from '@jp-evac/db';
import { listPrefectures } from 'lib/ref/municipalities';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (process.env.NODE_ENV === 'production') return res.status(404).end('Not found');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const prefs = await listPrefectures();
  const counts = await Promise.all(
    prefs.map(async (pref) => {
      const count = await prisma.evac_sites.count({
        where: {
          shelter_fields: { not: Prisma.DbNull },
          OR: [
            { pref_city: { startsWith: pref.prefName, mode: 'insensitive' } },
            { address: { startsWith: pref.prefName, mode: 'insensitive' } },
          ],
        },
      });
      return { prefCode: pref.prefCode, prefName: pref.prefName, count };
    })
  );

  const total = counts.reduce((acc, cur) => acc + cur.count, 0);
  const zeroPrefectures = counts.filter((c) => c.count === 0).map((c) => ({ prefCode: c.prefCode, prefName: c.prefName }));

  return res.status(200).json({
    updatedAt: new Date().toISOString(),
    total,
    counts,
    zeroPrefectures,
  });
}
