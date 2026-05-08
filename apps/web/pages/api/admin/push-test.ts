import type { NextApiRequest, NextApiResponse } from 'next';
import { isAuthorizedAdminSecret } from 'lib/server/adminAuth';
import { jsonError, jsonOk, rateLimit } from 'lib/server/security';
import { prisma } from 'lib/db/prisma';
import { sendWebPush } from 'lib/server/push';

const ADMIN_RATE_LIMIT = { keyPrefix: 'admin:push-test', limit: 10, windowMs: 10 * 60_000 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
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

  try {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { disabledAt: null },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
      take: 500,
    });

    let sent = 0;
    let failed = 0;
    let disabled = 0;

    for (const subscription of subscriptions) {
      try {
        const result = await sendWebPush(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          {
            title: '避難ナビ 通知テスト',
            body: '通知の準備が完了しています。',
            url: '/watch',
            tag: 'hinanavi-push-test',
          }
        );
        if (result.ok) {
          sent += 1;
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
        console.warn('[admin:push-test] send_failed', { subscriptionId: subscription.id, error: message });
      }
    }

    return jsonOk(res, {
      ok: true,
      attempted: subscriptions.length,
      sent,
      failed,
      disabled,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[admin:push-test] failed', { error: message });
    return jsonError(res, 500, { ok: false, error: 'internal_error', errorCode: 'INTERNAL_ERROR' });
  }
}
