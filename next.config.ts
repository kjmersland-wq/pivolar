import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The site analyser starts a real browser, which must stay outside the bundle.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  // The browser binary is read from disk at run time, so the build must be told to ship it with the chat route.
  outputFileTracingIncludes: { "/api/chat": ["./node_modules/@sparticuz/chromium/bin/**/*"] },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
