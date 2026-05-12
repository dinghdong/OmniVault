/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Allow build to continue even with type errors
    ignoreBuildErrors: true,
  },
  webpack: (config) => {
    // Ignore type errors from specific packages
    config.resolve.alias = {
      ...config.resolve.alias,
    };
    return config;
  },
};

module.exports = nextConfig;