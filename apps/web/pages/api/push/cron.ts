import type { NextApiRequest, NextApiResponse } from 'next';
import { jsonError, jsonOk } from 'lib/server/security';
import { buildPushMessages } from 'lib/push/dispatch';
import { sendExpoPush } from 'lib/push/expo';
import { listPushDevices, updatePushStore } from 'lib/push/store';

const MAX_DEVICE_AGE_MS = 120 * 24 * 60 * 60_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return jsonError(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const secret = process.env.PUSH_CRON_SECRET;
  const provided = (req.headers['x-cron-secret'] as string | undefined) ?? (req.query.secret as string | undefined);
  if (secret) {
    if (provided !== secret) {
      return jsonError(res, 401, { ok: false, error: 'Unauthorized' });
    }
  } else {
    const vercelCron = req.headers['x-vercel-cron'] === '1';
    if (!vercelCron || !process.env.VERCEL) {
      return jsonError(res, 503, { ok: false, error: 'Missing cron secret' });
    }
  }

  const devices = await listPushDevices();
  const activeDevices = devices.filter((device) => {
    const t = Date.parse(device.updatedAt);
    if (!Number.isFinite(t)) return true;
    return Date.now() - t <= MAX_DEVICE_AGE_MS;
  });

  const { messages, updates, areaCodes } = await buildPushMessages(activeDevices);
  const sendResult = await sendExpoPush(messages.map((m) => m.message));

  const updateMap = new Map(updates.map((u) => [u.deviceId, u.lastNotified]));
  const invalidSet = new Set(sendResult.invalidTokens);
  const nowIso = new Date().toISOString();

  await updatePushStore((store) => {
    const nextDevices = store.devices
      .filter((device) => !invalidSet.has(device.expoPushToken))
      .filter((device) => {
        const t = Date.parse(device.updatedAt);
        if (!Number.isFinite(t)) return true;
        return Date.now() - t <= MAX_DEVICE_AGE_MS;
      })
      .map((device) => {
        const nextNotified = updateMap.get(device.deviceId);
        if (!nextNotified) return device;
        return { ...device, lastNotified: nextNotified };
      });
    return { updatedAt: nowIso, devices: nextDevices };
  });

  return jsonOk(res, {
    ok: true,
    evaluatedDevices: activeDevices.length,
    areaCodes: areaCodes.length,
    pushesQueued: messages.length,
    invalidTokens: sendResult.invalidTokens.length,
    errors: sendResult.errors.slice(0, 10),
  });
}
