import type { NextApiRequest, NextApiResponse } from 'next';

const ALLOWED_TEMPLATES = [
    'disaportaldata.gsi.go.jp',
    'cyberjapandata.gsi.go.jp',
];

const TRANSPARENT_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
const TRANSPARENT_PNG = Buffer.from(TRANSPARENT_PNG_B64, 'base64');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const url = req.query.url as string;
    if (!url) {
        return res.status(400).json({ error: 'url required' });
    }

    // Basic security check
    try {
        const u = new URL(url);
        if (!ALLOWED_TEMPLATES.some((domain) => u.hostname.endsWith(domain))) {
            return res.status(403).json({ error: 'Forbidden domain' });
        }
    } catch {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    try {
        // 10s timeout
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(id);

        if (response.status === 404 || response.status === 410) {
            // Expected empty tile -> return transparent
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            return res.send(TRANSPARENT_PNG);
        }

        if (!response.ok) {
            // Other error -> transparent to avoid broken image icons? 
            // User requirement: "proxy ONLY allowed GSI hosts... If upstream status is 404 or 410 -> return 200 transparent... Else forward"
            // So effectively we forward other errors.
            return res.status(response.status).send(response.statusText);
        }

        const contentType = response.headers.get('content-type');
        if (contentType) res.setHeader('Content-Type', contentType);

        // Cache success for longer
        res.setHeader('Cache-Control', 'public, max-age=86400');

        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (err) {
        console.error('Proxy error:', err);
        // Return formatted error or transparent?
        // Safe fallback -> transparent might be better for map UX, but let's stick to 500 for network debugging if it's a real crash.
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
