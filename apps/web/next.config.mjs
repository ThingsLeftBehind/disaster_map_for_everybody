import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '../..');

const prismaTracingIncludes = [
  'apps/web/node_modules/.prisma/**',
  'apps/web/node_modules/@prisma/**',
  'packages/db/node_modules/.prisma/**',
  'packages/db/node_modules/@prisma/**',
  'packages/db/node_modules/@prisma/client/**',
];

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@jp-evac/shared', '@jp-evac/db'],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    outputFileTracingRoot: repoRoot,
  },
  async redirects() {
    return [
      {
        source: '/',
        has: [{ type: 'host', value: 'hinanavi.com' }],
        destination: 'https://www.hinanavi.com/main',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'hinanavi.com' }],
        destination: 'https://www.hinanavi.com/:path*',
        permanent: true,
      },
      {
        source: '/',
        destination: '/main',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
