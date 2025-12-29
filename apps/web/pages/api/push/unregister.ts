import type { NextApiRequest, NextApiResponse } from 'next';
import { jsonError, jsonOk } from 'lib/server/security';
import { PushUnregisterSchema } from 'lib/push/types';
import { removePushDevice } from 'lib/push/store';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return jsonError(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const parsed = PushUnregisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return jsonError(res, 400, { ok: false, error: 'Invalid payload' });
  }

  await removePushDevice(parsed.data.deviceId);
  return jsonOk(res, { ok: true });
}
