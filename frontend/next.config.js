/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export', // RESTORED: Use static export for reliable deployment
  trailingSlash: true,
  distDir: 'out', // RESTORED: Static export directory
  images: {
    unoptimized: true
  },
  transpilePackages: ['leaflet'],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://symptobridge-ai.onrender.com/api',
  },
};

module.exports = nextConfig; 