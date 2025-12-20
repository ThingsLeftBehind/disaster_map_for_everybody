import type { NextApiRequest, NextApiResponse } from 'next';
import { listMunicipalitiesByPref, listPrefectures } from 'lib/ref/municipalities';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const prefCode = (Array.isArray(req.query.prefCode) ? req.query.prefCode[0] : req.query.prefCode) as
    | string
    | undefined;

  if (!prefCode) {
    const prefectures = await listPrefectures();
    return res.status(200).json({ prefectures });
  }

  const municipalities = await listMunicipalitiesByPref(prefCode);
  return res.status(200).json({ municipalities });
}

