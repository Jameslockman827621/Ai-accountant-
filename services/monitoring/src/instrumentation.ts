import { metricsCollector, tracer } from './index';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('monitoring-service');

// Instrument Express middleware
export function instrumentExpress(app: unknown): void {
  // In production, use actual APM SDK
  logger.info('Express app instrumented for monitoring');
}

// Instrument database queries
export function instrumentDatabase(): void {
  // In production, use database query instrumentation
  logger.info('Database queries instrumented');
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
