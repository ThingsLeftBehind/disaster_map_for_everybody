const { getDefaultConfig } = require('expo/metro-config');
const https = require('https');

const config = getDefaultConfig(__dirname);

function proxyApi(req, res) {
  const targetUrl = new URL(req.url || '/', 'https://www.hinanavi.com');
  const headers = { ...req.headers, host: targetUrl.host, origin: targetUrl.origin };

  const proxyReq = https.request(
    targetUrl,
    {
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on('error', () => {
    res.statusCode = 502;
    res.end('Proxy error');
  });

  if (req.readable) {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
}

config.server = config.server ?? {};
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    if (req.url && req.url.startsWith('/api/')) {
      proxyApi(req, res);
      return;
    }
    return middleware(req, res, next);
  };
};

module.exports = config;
