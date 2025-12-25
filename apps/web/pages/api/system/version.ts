import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@jp-evac/db';

/**
 * GET /api/system/version
 * Returns the data version based on the latest shelter update.
 * Mobile app uses this to determine if caches need refresh.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Get the latest updated_at from evac_sites as the data version
        const result = await prisma.$queryRaw<Array<{ max_updated: Date | null }>>`
      SELECT MAX(updated_at) as max_updated FROM evac_sites
    `;

        const maxUpdated = result[0]?.max_updated;
        const dataVersion = maxUpdated ? maxUpdated.toISOString() : '1970-01-01T00:00:00.000Z';

        return res.status(200).json({
            dataVersion,
            generatedAt: new Date().toISOString(),
        });
    } catch (error) {
        // Fallback if DB is unavailable
        return res.status(200).json({
            dataVersion: 'unknown',
            generatedAt: new Date().toISOString(),
            error: 'Could not determine data version',
        });
    }
}
