/**
 * OpenTelemetry Metrics Instrumentation
 * Exports metrics to Prometheus for observability
 */

import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('metrics');

const exporterOptions = {
  port: parseInt(process.env.PROMETHEUS_EXPORTER_PORT || '9464', 10),
  endpoint: '/metrics',
};

// Create Prometheus exporter
const prometheusExporter = new PrometheusExporter(exporterOptions);

// Create meter provider
const meterProvider = new MeterProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.SERVICE_NAME || 'ai-accountant',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
  }),
  readers: [prometheusExporter as unknown as MetricReader],
});

// Get meter
export const meter = meterProvider.getMeter('ai-accountant-metrics');

// Request metrics
export const requestDuration = meter.createHistogram('http_request_duration_ms', {
  description: 'HTTP request duration in milliseconds',
  unit: 'ms',
});

export const requestCount = meter.createCounter('http_request_total', {
  description: 'Total number of HTTP requests',
});

export const requestErrors = meter.createCounter('http_request_errors_total', {
  description: 'Total number of HTTP request errors',
});

// Queue metrics
export const queueDepth = meter.createUpDownCounter('queue_depth', {
  description: 'Current queue depth',
});

export const queueLagSeconds = meter.createHistogram('queue_lag_seconds', {
  description: 'Time messages spend waiting in queue',
  unit: 's',
});

export const queueProcessed = meter.createCounter('queue_processed_total', {
  description: 'Total number of queue items processed',
});

export const queueFailed = meter.createCounter('queue_failed_total', {
  description: 'Total number of queue items failed',
});

// Extraction metrics
export const extractionAccuracy = meter.createHistogram('extraction_accuracy', {
  description: 'Document extraction accuracy score',
  unit: '1',
});

export const extractionLatency = meter.createHistogram('extraction_latency_ms', {
  description: 'Document extraction latency in milliseconds',
  unit: 'ms',
});

export const extractionCount = meter.createCounter('extraction_total', {
  description: 'Total number of extractions',
});

export const ocrThroughput = meter.createHistogram('ocr_throughput_per_minute', {
  description: 'Documents processed per minute by OCR',
  unit: '1',
});

// Reconciliation metrics
export const reconciliationSLA = meter.createHistogram('reconciliation_sla_score', {
  description: 'Reconciliation SLA score (0-1)',
  unit: '1',
});

export const reconciliationLatency = meter.createHistogram('reconciliation_latency_ms', {
  description: 'Reconciliation latency in milliseconds',
  unit: 'ms',
});

export const reconciliationMatched = meter.createCounter('reconciliation_matched_total', {
  description: 'Total number of matched transactions',
});

export const reconciliationUnmatched = meter.createCounter('reconciliation_unmatched_total', {
  description: 'Total number of unmatched transactions',
});

// Filing metrics
export const filingReadinessScore = meter.createHistogram('filing_readiness_score', {
  description: 'Filing readiness score (0-1)',
  unit: '1',
});

export const filingLatency = meter.createHistogram('filing_latency_ms', {
  description: 'Filing generation latency in milliseconds',
  unit: 'ms',
});

export const filingCount = meter.createCounter('filing_total', {
  description: 'Total number of filings',
});

export const filingErrors = meter.createCounter('filing_errors_total', {
  description: 'Total number of filing errors',
});

export const filingSuccessRate = meter.createUpDownCounter('filing_success_rate', {
  description: 'Rolling filing success ratio (0-1)',
});

// Assistant metrics
export const assistantQueryLatency = meter.createHistogram('assistant_query_latency_ms', {
  description: 'Assistant query latency in milliseconds',
  unit: 'ms',
});

export const assistantQueryCount = meter.createCounter('assistant_query_total', {
  description: 'Total number of assistant queries',
});

export const assistantConfidence = meter.createHistogram('assistant_confidence_score', {
  description: 'Assistant confidence score (0-1)',
  unit: '1',
});

export const assistantToolCalls = meter.createCounter('assistant_tool_calls_total', {
  description: 'Total number of assistant tool calls',
});

// Database metrics
export const dbQueryDuration = meter.createHistogram('db_query_duration_ms', {
  description: 'Database query duration in milliseconds',
  unit: 'ms',
});

export const dbConnections = meter.createUpDownCounter('db_connections', {
  description: 'Current number of database connections',
});

export const dbQueryErrors = meter.createCounter('db_query_errors_total', {
  description: 'Total number of database query errors',
});

// LLM metrics
export const llmRequestLatency = meter.createHistogram('llm_request_latency_ms', {
  description: 'LLM request latency in milliseconds',
  unit: 'ms',
});

export const llmRequestCount = meter.createCounter('llm_request_total', {
  description: 'Total number of LLM requests',
});

export const llmTokenUsage = meter.createCounter('llm_tokens_total', {
  description: 'Total number of LLM tokens used',
});

export const llmErrors = meter.createCounter('llm_errors_total', {
  description: 'Total number of LLM errors',
});

// Tenant metrics
export const tenantActive = meter.createUpDownCounter('tenant_active', {
  description: 'Number of active tenants',
});

export const tenantDocuments = meter.createCounter('tenant_documents_total', {
  description: 'Total number of documents processed per tenant',
});

// Error metrics
export const errorCount = meter.createCounter('errors_total', {
  description: 'Total number of errors by type',
});

// Initialize metrics server
export function initializeMetrics() {
  logger.info('Metrics initialized', {
    port: exporterOptions.port,
    endpoint: exporterOptions.endpoint,
  });
}

// Helper to record request metrics
export function recordRequestMetrics(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number
) {
  const labels = {
    method,
    path,
    status: statusCode.toString(),
  };

  requestCount.add(1, labels);
  requestDuration.record(durationMs, labels);

  if (statusCode >= 400) {
    requestErrors.add(1, labels);
  }
}
