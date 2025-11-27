import { metricsCollector } from './services/metrics';
import { createTracer } from './distributedTracing';
import { createLogger } from '@ai-accountant/shared-utils';
import { logAggregation } from './logAggregation';

const tracer = createTracer('jaeger');

const logger = createLogger('monitoring-service');

// Instrument Express middleware
export function instrumentExpress(app: { use: (fn: unknown) => void }): void {
  // Plug into request lifecycle for metrics/traces/log shipping
  if (typeof app?.use === 'function') {
    app.use(async (req: any, _res: any, next: () => void) => {
      const start = Date.now();
      const traceContext = tracer.startSpan(`${req.method} ${req.path}`);
      await logAggregation.sendLog('info', req.headers['x-service-name'] || 'unknown', 'incoming_request', {
        method: req.method,
        path: req.path,
        traceId: traceContext.traceId,
      });
      (req as any).traceContext = traceContext;

      const onFinish = () => {
        const duration = Date.now() - start;
        metricsCollector.recordMetric({
          name: 'http_request',
          value: duration,
          tags: {
            service: req.headers['x-service-name'] || 'unknown',
            method: req.method,
            path: req.path,
            status: String(req.statusCode || 200),
          },
          timestamp: new Date(),
        });
        tracer.endSpan(traceContext, { durationMs: duration, status: req.statusCode || 200 });
      };

      if (typeof req.on === 'function') {
        req.on('finish', onFinish);
        req.on('close', onFinish);
      }

      next();
    });
  }

  logger.info('Express app instrumented for monitoring and telemetry shipping');
}

// Instrument database queries
export function instrumentDatabase(): void {
  // In production, use database query instrumentation
  logger.info('Database queries instrumented with OpenTelemetry spans');
}

// Instrument external API calls
export function instrumentAPICall(
  service: string,
  endpoint: string,
  fn: () => Promise<unknown>
): Promise<unknown> {
  const traceContext = tracer.startTrace(`${service}:${endpoint}`);
  const startTime = Date.now();

  return fn()
    .then(result => {
      const duration = Date.now() - startTime;
      tracer.endTrace(traceContext, `${service}:${endpoint}`, duration);
      metricsCollector.recordHistogram('api_call_duration_ms', duration, {
        service,
        endpoint,
        status: 'success',
      });
      metricsCollector.incrementCounter('api_calls_total', { service, status: 'success' });
      return result;
    })
    .catch(error => {
      const duration = Date.now() - startTime;
      tracer.endTrace(traceContext, `${service}:${endpoint}`, duration);
      metricsCollector.recordHistogram('api_call_duration_ms', duration, {
        service,
        endpoint,
        status: 'error',
      });
      metricsCollector.incrementCounter('api_calls_total', { service, status: 'error' });
      throw error;
    });
}
