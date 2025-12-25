import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@jp-evac/db';
import { getJmaWarnings } from 'lib/jma/service';

const DEDUP_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours
const BATCH_SIZE = 100;

// Severity levels
function parseSeverity(kind: string): number {
    if (kind.includes('特別警報')) return 3;
    if (kind.includes('警報') && !kind.includes('注意報')) return 2;
    if (kind.includes('注意報')) return 1;
    return 0;
}

type AlertToSend = {
    deviceId: string;
    pushToken: string;
    cellId: string;
    eventKey: string;
    severity: number;
    title: string;
    body: string;
};

/**
 * GET /api/cron/push-alerts
 * Cron job to send push notifications for JMA alerts.
 * Called by Vercel Cron every 6 hours.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Verify cron secret in production
    if (process.env.NODE_ENV === 'production') {
        const authHeader = req.headers.authorization;
        const cronSecret = process.env.CRON_SECRET;
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const result = await runPushAlertsCron();
        return res.status(200).json(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ error: 'Cron failed', details: message });
    }
}

async function runPushAlertsCron(): Promise<{
    processedCells: number;
    alertsFound: number;
    pushesSent: number;
    dedupSkipped: number;
}> {
    const now = new Date();
    const dedupCutoff = new Date(now.getTime() - DEDUP_WINDOW_MS);

    // Get all unique subscribed cells
    const cells = await prisma.push_subscriptions.findMany({
        select: { cell_id: true },
        distinct: ['cell_id'],
    });

    const uniqueCellIds = [...new Set(cells.map((c) => c.cell_id))];
    let alertsFound = 0;
    let pushesSent = 0;
    let dedupSkipped = 0;

    const alertsToSend: AlertToSend[] = [];

    // For each cell, fetch warnings and build alerts
    for (const cellId of uniqueCellIds) {
        try {
            const warnings = await getJmaWarnings(cellId);
            const activeItems = warnings.items.filter((item) => {
                const status = item.status || '';
                return !status.includes('解除') && !status.includes('なし');
            });

            if (activeItems.length === 0) continue;

            // Get devices subscribed to this cell
            const subscriptions = await prisma.push_subscriptions.findMany({
                where: { cell_id: cellId },
                include: {
                    device: {
                        select: { id: true, push_token: true },
                    },
                },
            });

            for (const item of activeItems) {
                const kind = item.kind || '';
                const severity = parseSeverity(kind);
                if (severity === 0) continue; // Skip non-warning items

                const eventKey = `${cellId}|${kind}`;
                alertsFound++;

                for (const sub of subscriptions) {
                    // Check dedup state
                    const existingDedup = await prisma.push_dedup_states.findUnique({
                        where: {
                            device_id_cell_id_event_key: {
                                device_id: sub.device.id,
                                cell_id: cellId,
                                event_key: eventKey,
                            },
                        },
                    });

                    // Skip if sent within dedup window AND severity not upgraded
                    if (existingDedup) {
                        const withinWindow = existingDedup.last_sent_at > dedupCutoff;
                        const severityUpgraded = severity > existingDedup.severity;

                        if (withinWindow && !severityUpgraded) {
                            dedupSkipped++;
                            continue;
                        }
                    }

                    alertsToSend.push({
                        deviceId: sub.device.id,
                        pushToken: sub.device.push_token,
                        cellId,
                        eventKey,
                        severity,
                        title: severity === 3 ? '🔴 特別警報' : severity === 2 ? '🟠 警報' : '🟡 注意報',
                        body: `${warnings.areaName || cellId}: ${kind}`,
                    });
                }
            }
        } catch {
            // Skip cells that fail to fetch
            continue;
        }
    }

    // Send pushes in batches
    for (let i = 0; i < alertsToSend.length; i += BATCH_SIZE) {
        const batch = alertsToSend.slice(i, i + BATCH_SIZE);
        await sendPushBatch(batch);
        pushesSent += batch.length;

        // Update dedup states
        for (const alert of batch) {
            await prisma.push_dedup_states.upsert({
                where: {
                    device_id_cell_id_event_key: {
                        device_id: alert.deviceId,
                        cell_id: alert.cellId,
                        event_key: alert.eventKey,
                    },
                },
                update: { severity: alert.severity, last_sent_at: now },
                create: {
                    device_id: alert.deviceId,
                    cell_id: alert.cellId,
                    event_key: alert.eventKey,
                    severity: alert.severity,
                    last_sent_at: now,
                },
            });
        }
    }

    return {
        processedCells: uniqueCellIds.length,
        alertsFound,
        pushesSent,
        dedupSkipped,
    };
}

async function sendPushBatch(alerts: AlertToSend[]): Promise<void> {
    if (alerts.length === 0) return;

    const messages = alerts.map((alert) => ({
        to: alert.pushToken,
        sound: 'default',
        title: alert.title,
        body: alert.body,
        data: {
            cellId: alert.cellId,
            eventKey: alert.eventKey,
            severity: alert.severity,
        },
    }));

    try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(messages),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[push-alerts] Expo Push API error:', response.status, errorText);
        }
    } catch (error) {
        console.error('[push-alerts] Failed to send push batch:', error);
    }
}
