import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@jp-evac/db';

const MAX_SUBSCRIPTIONS = 12;

/**
 * PUT /api/push/subscriptions
 * Update cell subscriptions for a device (replaces all).
 * Body: { pushToken: string, cellIds: string[] }
 * 
 * GET /api/push/subscriptions (dev only)
 * Get current subscriptions for a device.
 * Query: { pushToken: string }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'PUT') {
        return handlePut(req, res);
    }

    if (req.method === 'GET') {
        // Dev only
        if (process.env.NODE_ENV === 'production') {
            return res.status(403).json({ error: 'Not available in production' });
        }
        return handleGet(req, res);
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
    const { pushToken, cellIds } = req.body;

    if (!pushToken || typeof pushToken !== 'string') {
        return res.status(400).json({ error: 'pushToken is required' });
    }

    if (!Array.isArray(cellIds)) {
        return res.status(400).json({ error: 'cellIds must be an array' });
    }

    // Validate cell IDs (should be JMA area codes)
    const validCellIds = cellIds
        .filter((id): id is string => typeof id === 'string' && /^\d{6}$/.test(id))
        .slice(0, MAX_SUBSCRIPTIONS);

    try {
        // Find the device
        const device = await prisma.push_devices.findUnique({
            where: { push_token: pushToken },
        });

        if (!device) {
            return res.status(404).json({ error: 'Device not registered. Call /api/push/register first.' });
        }

        // Delete existing subscriptions and create new ones
        await prisma.$transaction([
            prisma.push_subscriptions.deleteMany({
                where: { device_id: device.id },
            }),
            prisma.push_subscriptions.createMany({
                data: validCellIds.map((cellId) => ({
                    device_id: device.id,
                    cell_id: cellId,
                })),
                skipDuplicates: true,
            }),
        ]);

        // Get updated subscriptions
        const subscriptions = await prisma.push_subscriptions.findMany({
            where: { device_id: device.id },
            select: { cell_id: true },
        });

        return res.status(200).json({
            ok: true,
            cellIds: subscriptions.map((s) => s.cell_id),
            count: subscriptions.length,
            maxSubscriptions: MAX_SUBSCRIPTIONS,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ error: 'Update failed', details: message });
    }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
    const pushToken = req.query.pushToken as string;

    if (!pushToken) {
        return res.status(400).json({ error: 'pushToken query param is required' });
    }

    try {
        const device = await prisma.push_devices.findUnique({
            where: { push_token: pushToken },
            include: {
                subscriptions: {
                    select: { cell_id: true, created_at: true },
                },
            },
        });

        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        return res.status(200).json({
            deviceId: device.id,
            platform: device.platform,
            cellIds: device.subscriptions.map((s) => s.cell_id),
            subscriptions: device.subscriptions,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ error: 'Query failed', details: message });
    }
}
