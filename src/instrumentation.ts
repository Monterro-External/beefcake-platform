// Next.js calls register() once per server start. Telemetry is on only when an
// OTLP collector is configured, which the Aspire AppHost does; CI, tests and
// production run without it.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    await import('./instrumentation.node');
  }
}
