import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@jp-evac/db';
import { SafetyUpdateSchema } from '../../../lib/validators';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const parsed = SafetyUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  const { device_hash, status, last_known_lat, last_known_lon, saved_places, hazard_alert_prefs } = parsed.data;

  await prisma.device_settings.upsert({
    where: { device_hash },
    update: {
      transfer_code: undefined,
      saved_places: saved_places ?? undefined,
      hazard_alert_prefs: hazard_alert_prefs ?? undefined,
    },
    create: {
      device_hash,
      saved_places: saved_places ?? null,
      hazard_alert_prefs: hazard_alert_prefs ?? null,
    },
  });

  const safety = await prisma.safety_status.upsert({
    where: { device_hash },
    update: {
      status,
      last_known_lat,
      last_known_lon,
      updated_at: new Date(),
    },
    create: {
      device_hash,
      status,
      last_known_lat,
      last_known_lon,
    },
  });

  res.status(200).json({ safety });
}
