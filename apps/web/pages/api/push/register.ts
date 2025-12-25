import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@jp-evac/db';

const MAX_SUBSCRIPTIONS = 12;

/**
 * POST /api/push/register
 * Register a push token for a device.
 * Body: { pushToken: string, platform: 'ios' | 'android' | 'expo' }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { pushToken, platform } = req.body;

    if (!pushToken || typeof pushToken !== 'string') {
        return res.status(400).json({ error: 'pushToken is required' });
    }

    if (!platform || !['ios', 'android', 'expo'].includes(platform)) {
        return res.status(400).json({ error: 'platform must be ios, android, or expo' });
    }

    try {
        const device = await prisma.push_devices.upsert({
            where: { push_token: pushToken },
            update: { platform, updated_at: new Date() },
            create: { push_token: pushToken, platform },
        });

        return res.status(200).json({
            ok: true,
            deviceId: device.id,
            maxSubscriptions: MAX_SUBSCRIPTIONS,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ error: 'Registration failed', details: message });
    }
}
