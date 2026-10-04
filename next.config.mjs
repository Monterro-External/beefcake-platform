// Plain JavaScript on purpose: `next start` loads this file at runtime, and a
// .ts config would need the `typescript` package in the production image.

/** @type {import('next').NextConfig} */
const config = {
  // better-sqlite3 is a native module: it has to stay outside the bundle.
  // The OpenTelemetry SDK (src/instrumentation.node.ts) loads gRPC and patches
  // Node's own modules, so it stays outside the bundle too.
  serverExternalPackages: ['better-sqlite3', '@opentelemetry/sdk-node', '@grpc/grpc-js'],
  // Playwright drives the dev server over 127.0.0.1 rather than localhost.
  allowedDevOrigins: ['127.0.0.1'],
};

export default config;
