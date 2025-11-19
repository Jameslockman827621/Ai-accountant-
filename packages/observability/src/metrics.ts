import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

type Labels = Record<string, string>;

const exporterOptions = {
  port: parseInt(process.env.PROMETHEUS_EXPORTER_PORT || '9464', 10),
  endpoint: '/metrics',
};

let meterProvider: MeterProvider | null = null;
let exporter: MetricReader | null = null;

function initializeMetrics(): void {
  if (meterProvider && exporter) {
    return;
  }

  const prometheusExporter = new PrometheusExporter(exporterOptions);
  exporter = prometheusExporter as unknown as MetricReader;

  meterProvider = new MeterProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: process.env.SERVICE_NAME || 'ai-accountant',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
    }),
    readers: [exporter],
  });
}

initializeMetrics();

export const meter = meterProvider!.getMeter('ai-accountant-metrics');

const requestDuration = meter.createHistogram('http_request_duration_ms', {
  description: 'HTTP request duration in milliseconds',
  unit: 'ms',
});

const requestCount = meter.createCounter('http_request_total', {
  description: 'Total HTTP requests',
});

const requestErrors = meter.createCounter('http_request_errors_total', {
  description: 'Total HTTP request errors',
});

const externalApiLatency = meter.createHistogram('external_api_latency_ms', {
  description: 'Latency for outbound API calls',
  unit: 'ms',
});

const externalApiCount = meter.createCounter('external_api_requests_total', {
  description: 'Total outbound API calls',
});

const externalApiErrors = meter.createCounter('external_api_errors_total', {
  description: 'Outbound API errors',
});

const llmRequestLatency = meter.createHistogram('llm_request_latency_ms', {
  description: 'LLM request latency in milliseconds',
  unit: 'ms',
});

const llmRequestCount = meter.createCounter('llm_request_total', {
  description: 'Total LLM requests',
});

const llmTokenUsage = meter.createCounter('llm_tokens_total', {
  description: 'LLM token usage',
});

const llmErrors = meter.createCounter('llm_errors_total', {
  description: 'LLM request errors',
});

function buildLabels(base: Labels, serviceName?: string, extra?: Labels): Labels {
  return {
    ...(serviceName ? { service: serviceName } : {}),
    ...base,
    ...(extra || {}),
  };
}

export function recordRequestMetrics(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  serviceName?: string
): void {
  const labels = buildLabels(
    {
      method,
      path,
      status: statusCode.toString(),
    },
    serviceName
  );

  requestCount.add(1, labels);
  requestDuration.record(durationMs, labels);

  if (statusCode >= 400) {
    requestErrors.add(1, labels);
  }
}

export function recordExternalApiCall(
  provider: string,
  operation: string,
  durationMs: number,
  serviceName?: string
): void {
  const labels = buildLabels({ provider, operation }, serviceName);
  externalApiCount.add(1, labels);
  externalApiLatency.record(durationMs, labels);
}

export function recordExternalApiError(
  provider: string,
  operation: string,
  serviceName?: string
): void {
  const labels = buildLabels({ provider, operation }, serviceName);
  externalApiErrors.add(1, labels);
}

export function recordLLMRequest(options: {
  service: string;
  model?: string;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}): void {
  const labels = buildLabels(
    {
      model: options.model || 'unknown',
    },
    options.service
  );
  llmRequestCount.add(1, labels);
  llmRequestLatency.record(options.durationMs, labels);

  if (options.promptTokens) {
    llmTokenUsage.add(options.promptTokens, { ...labels, token_type: 'prompt' });
  }
  if (options.completionTokens) {
    llmTokenUsage.add(options.completionTokens, { ...labels, token_type: 'completion' });
  }
  if (options.totalTokens) {
    llmTokenUsage.add(options.totalTokens, { ...labels, token_type: 'total' });
  }
}

export function recordLLMError(service: string, model?: string): void {
  const labels = buildLabels(
    {
      model: model || 'unknown',
    },
    service
  );
  llmErrors.add(1, labels);
}
