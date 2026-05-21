/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Allow build to continue even with type errors
    ignoreBuildErrors: true,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Exclude 0G Storage SDK from webpack bundle — uses Node.js native modules.
      // API routes will require() it directly at runtime.
      const existing = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
      config.externals = [...existing, '@0glabs/0g-ts-sdk'];
    } else {
      // Browser stubs for Node.js built-ins (not needed client-side)
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
      };
    }
    config.resolve.alias = {
      ...config.resolve.alias,
    };
    return config;
  },
};

module.exports = nextConfig;