import { NextApiRequest, NextApiResponse } from 'next';
import { ensureDevice } from '../../../lib/device';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const device = await ensureDevice(req, res);
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }
  res.json({ transfer_code: device.transferCode, device_hash: device.deviceHash });
}
