import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@jp-evac/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const device_hash = req.query.device_hash as string;
  if (!device_hash) {
    return res.status(400).json({ error: 'device_hash is required' });
  }

  const device = await prisma.device_settings.findUnique({
    where: { device_hash },
    include: { safety_status: true },
  });

  if (!device) {
    return res.status(404).json({ error: 'Not found' });
  }

  res.status(200).json({ device });
}
