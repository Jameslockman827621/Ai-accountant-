import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const defaultCollector = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4318';
const traceEndpoint =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || `${defaultCollector}/v1/traces`;
const metricsEndpoint =
  process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || `${defaultCollector}/v1/metrics`;
const logsEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || `${defaultCollector}/v1/logs`;

const metricInterval = Number(process.env.OTEL_METRIC_EXPORT_INTERVAL || 60000);

if (process.env.OTEL_DEBUG === 'true') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

function buildResource(): Resource {
  return new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]:
      process.env.OTEL_SERVICE_NAME || process.env.SERVICE_NAME || 'ai-accountant',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.DEPLOYMENT_ENV || 'local',
  });
}

function buildLoggerProvider(resource: Resource): { loggerProvider: LoggerProvider; logRecordProcessor: BatchLogRecordProcessor } {
  const loggerProvider = new LoggerProvider({ resource });
  const logExporter = new OTLPLogExporter({ url: logsEndpoint });
  const logRecordProcessor = new BatchLogRecordProcessor(logExporter);
  loggerProvider.addLogRecordProcessor(logRecordProcessor);
  return { loggerProvider, logRecordProcessor };
}

const traceExporter = new OTLPTraceExporter({ url: traceEndpoint });
const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({ url: metricsEndpoint }),
  exportIntervalMillis: metricInterval,
});

export function createObservabilitySDK(): NodeSDK {
  const resource = buildResource();
  const { loggerProvider, logRecordProcessor } = buildLoggerProvider(resource);

  return new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    loggerProvider,
    logRecordProcessor,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          ignoreOutgoingUrls: [/\/health$/],
        },
        '@opentelemetry/instrumentation-express': {
          enabled: true,
        },
      }),
    ],
  });
}

const sdk = createObservabilitySDK();

export async function startObservability(): Promise<void> {
  await sdk.start();
}

export async function shutdownObservability(): Promise<void> {
  await sdk.shutdown();
}

export { sdk };
