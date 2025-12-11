import { NextApiRequest, NextApiResponse } from 'next';
import { ensureDevice } from '../../lib/device';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';

const bodySchema = z.object({ transfer_code: z.string().min(4) });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const device = await ensureDevice(req, res);
  const target = await prisma.device.findUnique({ where: { transferCode: parsed.data.transfer_code } });
  if (!target) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const current = await prisma.device.findUnique({ where: { deviceHash: device.deviceHash } });
  if (current && current.id !== target.id) {
    await prisma.device.delete({ where: { id: current.id } });
  }
  const updated = await prisma.device.update({
    where: { id: target.id },
    data: { deviceHash: device.deviceHash }
  });
  res.json({ status: 'restored', device_hash: updated.deviceHash, transfer_code: updated.transferCode });
}
