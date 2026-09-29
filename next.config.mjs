// Plain JavaScript on purpose: `next start` loads this file at runtime, and a
// .ts config would need the `typescript` package in the production image.

/** @type {import('next').NextConfig} */
const config = {
  // better-sqlite3 is a native module: it has to stay outside the bundle.
  serverExternalPackages: ['better-sqlite3'],
  // Playwright drives the dev server over 127.0.0.1 rather than localhost.
  allowedDevOrigins: ['127.0.0.1'],
};

export default config;
