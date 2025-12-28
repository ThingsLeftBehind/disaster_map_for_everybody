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
  experimental: {
    outputFileTracingRoot: repoRoot,
  },
};

export default nextConfig;
