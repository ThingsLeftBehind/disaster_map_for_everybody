import type { NextApiRequest, NextApiResponse } from 'next';
import { getAdminState } from 'lib/store/adapter';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await getAdminState();
  return res.status(200).json({ banner: admin.banner });
}

