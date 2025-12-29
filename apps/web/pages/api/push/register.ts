import type { NextApiRequest, NextApiResponse } from 'next';
import { jsonError, jsonOk } from 'lib/server/security';
import { PushRegisterSchema } from 'lib/push/types';
import { upsertPushDevice } from 'lib/push/store';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return jsonError(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const parsed = PushRegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return jsonError(res, 400, { ok: false, error: 'Invalid payload' });
  }

  const record = await upsertPushDevice(parsed.data);
  return jsonOk(res, { ok: true, updatedAt: record.updatedAt });
}
