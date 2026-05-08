import type { NextApiRequest, NextApiResponse } from 'next';
import { isAuthorizedAdminSecret } from 'lib/server/adminAuth';
import { jsonError, jsonOk, rateLimit } from 'lib/server/security';
import { prisma } from 'lib/db/prisma';
import { sendWebPush } from 'lib/server/push';
import { listNotifyEnabledWatchRegions } from 'lib/server/watchRegions';
import { buildRegionNotificationCandidate, resolveRegionStatus } from 'lib/server/watchRegionStatus';

const ADMIN_RATE_LIMIT = { keyPrefix: 'admin:push-check-warnings', limit: 20, windowMs: 10 * 60_000 };
const CHANNEL = 'jma-warning';

function first(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function parseDryRun(req: NextApiRequest): boolean {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
  const raw = first(req.query.dryRun) ?? body.dryRun;
  if (raw === false || raw === 'false' || raw === '0') return false;
  return true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonError(res, 405, { ok: false, error: 'method_not_allowed', errorCode: 'METHOD_NOT_ALLOWED' });
  }
  const rl = rateLimit(req, ADMIN_RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return jsonError(res, 429, { ok: false, error: 'rate_limited', errorCode: 'RATE_LIMITED' });
  }
  if (!isAuthorizedAdminSecret(req)) {
    return jsonError(res, 401, { ok: false, error: 'unauthorized', errorCode: 'UNAUTHORIZED' });
  }

  const dryRun = parseDryRun(req);

  try {
    const regions = await listNotifyEnabledWatchRegions();
    const subscriptions = await prisma.pushSubscription.findMany({
      where: {
        disabledAt: null,
        deviceId: { in: Array.from(new Set(regions.map((region) => region.deviceDbId))) },
      },
      select: { id: true, deviceId: true, endpoint: true, p256dh: true, auth: true },
    });
    const subscriptionsByDevice = new Map<string, typeof subscriptions>();
    for (const subscription of subscriptions) {
      const list = subscriptionsByDevice.get(subscription.deviceId) ?? [];
      list.push(subscription);
      subscriptionsByDevice.set(subscription.deviceId, list);
    }

    let candidateNotifications = 0;
    let sent = 0;
    let skippedDuplicate = 0;
    let failed = 0;
    let disabled = 0;

    for (const region of regions) {
      const withStatus = await resolveRegionStatus(region);
      const candidate = buildRegionNotificationCandidate(withStatus);
      if (!candidate) continue;
      candidateNotifications += 1;

      const existing = await prisma.notificationDelivery.findFirst({
        where: {
          watchRegionId: region.id,
          fingerprint: candidate.fingerprint,
          channel: CHANNEL,
        },
        select: { id: true },
      });
      if (existing) {
        skippedDuplicate += 1;
        continue;
      }
      if (dryRun) continue;

      const deviceSubscriptions = subscriptionsByDevice.get(region.deviceDbId) ?? [];
      let sentForRegion = 0;
      for (const subscription of deviceSubscriptions) {
        try {
          const result = await sendWebPush(
            { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
            {
              title: candidate.title,
              body: candidate.body,
              url: candidate.url,
              tag: `hinanavi-${CHANNEL}-${region.id}`,
            }
          );
          if (result.ok) {
            sent += 1;
            sentForRegion += 1;
            continue;
          }
          failed += 1;
          if (result.status === 404 || result.status === 410) {
            disabled += 1;
            await prisma.pushSubscription.update({ where: { id: subscription.id }, data: { disabledAt: new Date(), updatedAt: new Date() } });
          }
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          console.warn('[admin:push-check-warnings] send_failed', { regionId: region.id, subscriptionId: subscription.id, error: message });
        }
      }

      if (sentForRegion > 0) {
        await prisma.notificationDelivery
          .create({
            data: {
              deviceId: region.deviceDbId,
              watchRegionId: region.id,
              fingerprint: candidate.fingerprint,
              title: candidate.title,
              body: candidate.body,
              channel: CHANNEL,
            },
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            if (!/Unique constraint failed/i.test(message)) throw error;
          });
      }
    }

    return jsonOk(res, {
      ok: true,
      dryRun,
      checkedRegions: regions.length,
      candidateNotifications,
      sent,
      skippedDuplicate,
      failed,
      disabled,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[admin:push-check-warnings] failed', { error: message, dryRun });
    return jsonError(res, 500, { ok: false, error: 'internal_error', errorCode: 'INTERNAL_ERROR' });
  }
}
