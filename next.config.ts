import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is off: almost every page depends on the signed-in user
  // and on moderation state, so pages render dynamically per request.
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
