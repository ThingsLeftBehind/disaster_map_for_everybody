import type { NextApiRequest, NextApiResponse } from 'next';
import https from 'node:https';
import crypto from 'node:crypto';

const UPSTREAM_BASE = 'https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data';
const TIMEOUT_MS = 6_000;
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
  'base64'
);
const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function setDebugHeaders(res: NextApiResponse, args: {
  upstreamUrl: string;
  upstreamStatus: string;
  mode: 'pass' | 'blank';
  contentType: string;
  length: string;
  sha256: string;
}) {
  res.setHeader('x-upstream-url', args.upstreamUrl);
  res.setHeader('x-upstream-status', args.upstreamStatus);
  res.setHeader('x-proxy-mode', args.mode);
  res.setHeader('x-upstream-ct', args.contentType);
  res.setHeader('x-upstream-len', args.length);
  res.setHeader('x-upstream-sha256-16', args.sha256);
}

function sendBlank(
  res: NextApiResponse,
  upstreamUrl: string,
  upstreamStatus: string,
  contentType: string,
  length: string,
  sha256: string
) {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', CACHE_CONTROL);
  setDebugHeaders(res, { upstreamUrl, upstreamStatus, mode: 'blank', contentType, length, sha256 });
  res.status(200).send(TRANSPARENT_PNG);
}

function normalizeTileParam(value: string): string {
  return value.replace(/(?:\.png)+$/i, '');
}

function isPngBuffer(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

function isImageContentType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('image/');
}

function sha256Hex16(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function proxyTile(req: NextApiRequest, res: NextApiResponse, upstreamUrl: string) {
  const upstreamReq = https.get(
    upstreamUrl,
    {
      headers: {
        Accept: 'image/png,image/*;q=0.9,*/*;q=0.1',
        'User-Agent': 'hinanavi-dev-tile-proxy',
      },
    },
    (upstreamRes) => {
      const status = upstreamRes.statusCode ?? 0;
      const contentType = String(upstreamRes.headers['content-type'] ?? '');
      const lengthHeader = String(upstreamRes.headers['content-length'] ?? '0');

      if (status === 404 || status === 204) {
        upstreamRes.resume();
        return sendBlank(res, upstreamUrl, String(status || 'ERR'), contentType || 'unknown', lengthHeader, 'ERR');
      }

      const chunks: Buffer[] = [];
      upstreamRes.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      upstreamRes.on('end', () => {
        const buf = Buffer.concat(chunks);
        const sha = buf.length > 0 ? sha256Hex16(buf) : 'ERR';
        const isImage = isImageContentType(contentType) || isPngBuffer(buf);
        if (!isImage || buf.length === 0) {
          return sendBlank(res, upstreamUrl, String(status || 'ERR'), contentType || 'unknown', String(buf.length), sha);
        }
        const responseContentType = contentType || 'image/png';
        res.statusCode = 200;
        res.setHeader('Content-Type', responseContentType);
        res.setHeader('Cache-Control', CACHE_CONTROL);
        setDebugHeaders(res, {
          upstreamUrl,
          upstreamStatus: String(status || 'ERR'),
          mode: 'pass',
          contentType: contentType || 'unknown',
          length: String(buf.length),
          sha256: sha,
        });
        return res.status(200).send(buf);
      });
      upstreamRes.on('error', () => {
        if (!res.headersSent) sendBlank(res, upstreamUrl, String(status || 'ERR'), contentType || 'unknown', lengthHeader, 'ERR');
        else res.end();
      });
    }
  );

  upstreamReq.setTimeout(TIMEOUT_MS, () => {
    upstreamReq.destroy(new Error('timeout'));
  });

  upstreamReq.on('error', () => {
    if (!res.headersSent) sendBlank(res, upstreamUrl, 'ERR', 'ERR', '0', 'ERR');
    else res.end();
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    setDebugHeaders(res, {
      upstreamUrl: 'invalid',
      upstreamStatus: 'ERR',
      mode: 'blank',
      contentType: 'ERR',
      length: '0',
      sha256: 'ERR',
    });
    return res.status(405).end('Method not allowed');
  }

  const zRaw = String(Array.isArray(req.query.z) ? req.query.z[0] : req.query.z ?? '');
  const xRaw = String(Array.isArray(req.query.x) ? req.query.x[0] : req.query.x ?? '');
  const yRaw = String(Array.isArray(req.query.y) ? req.query.y[0] : req.query.y ?? '');
  const z = normalizeTileParam(zRaw);
  const x = normalizeTileParam(xRaw);
  const y = normalizeTileParam(yRaw);
  if (!z || !x || !y) {
    setDebugHeaders(res, {
      upstreamUrl: 'invalid',
      upstreamStatus: 'ERR',
      mode: 'blank',
      contentType: 'ERR',
      length: '0',
      sha256: 'ERR',
    });
    return res.status(400).end('Bad request');
  }

  const upstreamUrl = `${UPSTREAM_BASE}/${z}/${x}/${y}.png`;
  return proxyTile(req, res, upstreamUrl);
}
