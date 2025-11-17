/**
 * OpenTelemetry Tracing Instrumentation
 * Provides distributed tracing with W3C trace context propagation
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('tracing');

// Create trace exporter (Jaeger/Tempo compatible)
const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://localhost:4318/v1/traces',
  headers: process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS
    ? JSON.parse(process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS)
    : {},
});

// Create SDK
const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.SERVICE_NAME || 'ai-accountant',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
  }),
  traceExporter,
  spanProcessor: new BatchSpanProcessor(traceExporter, {
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
    scheduledDelayMillis: 5000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable fs instrumentation in production for performance
      '@opentelemetry/instrumentation-fs': {
        enabled: process.env.NODE_ENV !== 'production',
      },
    }),
  ],
});

// Initialize tracing
export function initializeTracing() {
  sdk.start();
  logger.info('Tracing initialized', {
    endpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://localhost:4318/v1/traces',
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .then(() => logger.info('Tracing shutdown complete'))
      .catch((error) => logger.error('Error shutting down tracing', error));
  });
}

// Export SDK for manual instrumentation
export { sdk };
