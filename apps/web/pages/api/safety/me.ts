import type { NextApiRequest, NextApiResponse } from 'next';
import { getDeviceState } from 'lib/store/adapter';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const device_hash = req.query.device_hash as string;
  if (!device_hash) {
    return res.status(400).json({ error: 'device_hash is required' });
  }

  const device = await getDeviceState(device_hash);
  res.status(200).json({ device });
}
