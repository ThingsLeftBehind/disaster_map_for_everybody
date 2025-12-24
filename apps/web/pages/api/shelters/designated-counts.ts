import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma, prisma } from '@jp-evac/db';
import { listPrefectures } from 'lib/ref/municipalities';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // if (process.env.NODE_ENV === 'production') return res.status(404).end('Not found');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const prefs = await listPrefectures();

    // Safety check just in case
    if (!prefs || !Array.isArray(prefs)) {
      throw new Error('Failed to load prefectures');
    }

    const counts = await Promise.all(
      prefs.map(async (pref) => {
        try {
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
        } catch (e) {
          console.error(`Count failed for ${pref.prefName}`, e);
          return { prefCode: pref.prefCode, prefName: pref.prefName, count: 0 };
        }
      })
    );

    const total = counts.reduce((acc, cur) => acc + cur.count, 0);
    const zeroPrefectures = counts.filter((c) => c.count === 0).map((c) => ({ prefCode: c.prefCode, prefName: c.prefName }));

    return res.status(200).json({
      ok: true,
      updatedAt: new Date().toISOString(),
      total,
      counts,
      zeroPrefectures,
    });
  } catch (error) {
    console.error('[DesignatedCounts] Fatal error:', error);
    // Return a valid empty structure so UI doesn't crash
    return res.status(200).json({
      ok: false,
      updatedAt: new Date().toISOString(),
      total: 0,
      counts: [],
      zeroPrefectures: [],
      error: 'Data currently unavailable'
    });
  }
}
