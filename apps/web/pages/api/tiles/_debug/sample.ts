import type { NextApiRequest, NextApiResponse } from 'next';

const LCM_SAMPLE = { z: 11, x: 1819, y: 805 };
const TSUNAMI_SAMPLE = { z: 11, x: 1818, y: 806 };

const LCM_BASE = 'https://cyberjapandata.gsi.go.jp/xyz/lcm25k_2012';
const TSUNAMI_BASE = 'https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data';

const TIMEOUT_MS = 6_000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Accept: 'image/png,image/*;q=0.9,*/*;q=0.1',
        'User-Agent': 'hinanavi-dev-tile-proxy',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function probe(url: string) {
  try {
    const res = await fetchWithTimeout(url);
    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? null,
    };
  } catch {
    return { status: 'ERR', contentType: null };
  }
}

async function probeLocal(url: string) {
  try {
    const res = await fetchWithTimeout(url);
    return {
      status: res.status,
      mode: res.headers.get('x-proxy-mode') ?? null,
    };
  } catch {
    return { status: 'ERR', mode: null };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (process.env.NODE_ENV === 'production') return res.status(404).end('Not found');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const host = req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] as string) ?? 'http';
  const origin = host ? `${proto}://${host}` : null;

  const lcmUpstreamUrl = `${LCM_BASE}/${LCM_SAMPLE.z}/${LCM_SAMPLE.x}/${LCM_SAMPLE.y}.png`;
  const tsunamiUpstreamUrl = `${TSUNAMI_BASE}/${TSUNAMI_SAMPLE.z}/${TSUNAMI_SAMPLE.x}/${TSUNAMI_SAMPLE.y}.png`;

  const lcmLocalUrl = origin ? `${origin}/api/tiles/lcm25k_2012/${LCM_SAMPLE.z}/${LCM_SAMPLE.x}/${LCM_SAMPLE.y}.png` : null;
  const tsunamiLocalUrl = origin ? `${origin}/api/tiles/tsunami/${TSUNAMI_SAMPLE.z}/${TSUNAMI_SAMPLE.x}/${TSUNAMI_SAMPLE.y}.png` : null;

  const [lcmUpstream, tsunamiUpstream, lcmLocal, tsunamiLocal] = await Promise.all([
    probe(lcmUpstreamUrl),
    probe(tsunamiUpstreamUrl),
    lcmLocalUrl ? probeLocal(lcmLocalUrl) : Promise.resolve({ status: 'ERR', mode: null }),
    tsunamiLocalUrl ? probeLocal(tsunamiLocalUrl) : Promise.resolve({ status: 'ERR', mode: null }),
  ]);

  return res.status(200).json({
    lcm25k: {
      localUrl: lcmLocalUrl,
      upstreamUrl: lcmUpstreamUrl,
      local: lcmLocal,
      upstream: lcmUpstream,
    },
    tsunami: {
      localUrl: tsunamiLocalUrl,
      upstreamUrl: tsunamiUpstreamUrl,
      local: tsunamiLocal,
      upstream: tsunamiUpstream,
    },
  });
}
