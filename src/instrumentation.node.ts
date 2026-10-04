// Traces, metrics and logs to the Aspire dashboard over OTLP/gRPC. Endpoint,
// headers, service name and intervals all come from the OTEL_* variables the
// AppHost injects. Next.js adds its own spans for routes and server actions.
import { format } from 'node:util';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),
  logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
  instrumentations: [new HttpInstrumentation()],
}).start();

// The app logs through `console`. Mirror each call as a structured log record,
// with its level and the active trace, so the dashboard can filter and link it;
// the original still writes to stdout for the console log view.
const logger = logs.getLogger('console');
const levels = [
  ['debug', SeverityNumber.DEBUG],
  ['log', SeverityNumber.INFO],
  ['info', SeverityNumber.INFO],
  ['warn', SeverityNumber.WARN],
  ['error', SeverityNumber.ERROR],
] as const;
for (const [method, severityNumber] of levels) {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    logger.emit({ severityNumber, severityText: method.toUpperCase(), body: format(...args) });
    original(...args);
  };
}
