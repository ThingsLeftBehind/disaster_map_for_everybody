import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { lookupAreaName } from 'lib/ref/municipalities';

const QuerySchema = z.object({
  prefCode: z
    .preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().regex(/^\d{2}$/))
    .optional(),
  muniCode: z
    .preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().regex(/^\d{6}$/))
    .optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });

  const area = await lookupAreaName({ prefCode: parsed.data.prefCode ?? null, muniCode: parsed.data.muniCode ?? null });
  return res.status(200).json({ area });
}

