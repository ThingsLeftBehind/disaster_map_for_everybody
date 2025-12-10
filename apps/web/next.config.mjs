/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@jp-evac/shared', '@jp-evac/db'],
};

export default nextConfig;
