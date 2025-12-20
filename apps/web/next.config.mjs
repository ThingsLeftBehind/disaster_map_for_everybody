/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@jp-evac/shared'],
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';
    const securityHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'geolocation=(self)' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    ];

    if (isProd) {
      const csp = [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org https://tile.openstreetmap.org https://disaportal.gsi.go.jp https://disaportaldata.gsi.go.jp https://cyberjapandata.gsi.go.jp",
        "connect-src 'self' https://mreversegeocoder.gsi.go.jp",
        "font-src 'self' data:",
        "worker-src 'self' blob:",
      ].join('; ');
      securityHeaders.push({ key: 'Content-Security-Policy', value: csp });
    }

    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
