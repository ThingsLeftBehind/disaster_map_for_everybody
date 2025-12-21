import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  return res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
    env: process.env.NODE_ENV ?? 'unknown',
  });
}
