import type { NextApiRequest, NextApiResponse } from 'next';

const ALLOWED_TEMPLATES = [
    'disaportaldata.gsi.go.jp',
    'cyberjapandata.gsi.go.jp',
];

const TRANSPARENT_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
const TRANSPARENT_PNG = Buffer.from(TRANSPARENT_PNG_B64, 'base64');
const CACHE_CONTROL_PASS = 'public, max-age=86400';
const CACHE_CONTROL_BLANK = 'public, max-age=3600';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function setDebugHeaders(
  res: NextApiResponse,
  args: { upstreamUrl: string; upstreamStatus: string; mode: 'pass' | 'blank' }
) {
  res.setHeader('x-upstream-url', args.upstreamUrl);
  res.setHeader('x-upstream-status', args.upstreamStatus);
  res.setHeader('x-proxy-mode', args.mode);
}

function isPngBuffer(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

function isImageContentType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('image/');
}

function sendBlank(res: NextApiResponse, upstreamUrl: string, upstreamStatus: string) {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', CACHE_CONTROL_BLANK);
  setDebugHeaders(res, { upstreamUrl, upstreamStatus, mode: 'blank' });
  res.status(200).send(TRANSPARENT_PNG);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const url = req.query.url as string;
    if (!url) {
        setDebugHeaders(res, { upstreamUrl: '', upstreamStatus: 'ERR', mode: 'blank' });
        return res.status(400).json({ error: 'url required' });
    }

    // Basic security check
    try {
        const u = new URL(url);
        if (!ALLOWED_TEMPLATES.some((domain) => u.hostname.endsWith(domain))) {
            setDebugHeaders(res, { upstreamUrl: url, upstreamStatus: 'ERR', mode: 'blank' });
            return res.status(403).json({ error: 'Forbidden domain' });
        }
    } catch {
        setDebugHeaders(res, { upstreamUrl: url, upstreamStatus: 'ERR', mode: 'blank' });
        return res.status(400).json({ error: 'Invalid URL' });
    }

    try {
        // 10s timeout
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(id);

        const status = response.status;
        const contentType = response.headers.get('content-type') ?? '';
        if (status === 404 || status === 204) {
            return sendBlank(res, url, String(status));
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const isImage = isImageContentType(contentType) || isPngBuffer(buffer);
        if (!isImage || buffer.length === 0) {
            return sendBlank(res, url, String(status));
        }

        res.setHeader('Content-Type', contentType || 'image/png');
        res.setHeader('Cache-Control', CACHE_CONTROL_PASS);
        setDebugHeaders(res, { upstreamUrl: url, upstreamStatus: String(status), mode: 'pass' });
        res.status(200).send(buffer);
    } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.error('Proxy error:', err);
        }
        return sendBlank(res, url, 'ERR');
    }
}
