import { createLogger } from '@ai-accountant/shared-utils';
import { Tracer, TraceContext } from './index';

const logger = createLogger('monitoring-service');

// OpenTelemetry integration
export class OpenTelemetryTracer {
  private tracer: Tracer;

  constructor() {
    this.tracer = new Tracer();
  }

  startSpan(
    name: string,
    parentContext?: TraceContext,
    attributes?: Record<string, string>
  ): TraceContext {
    const context = this.tracer.startTrace(name, parentContext);
    logger.debug('OpenTelemetry span started', { name, attributes });
    return context;
  }

  endSpan(context: TraceContext, name: string): void {
    this.tracer.endTrace(context, name, 0);
    logger.debug('OpenTelemetry span ended', { name });
  }

  addEvent(context: TraceContext, name: string, attributes?: Record<string, unknown>): void {
    logger.debug('Event added to span', { name, attributes });
  }

  setAttribute(context: TraceContext, key: string, value: string): void {
    logger.debug('Attribute set on span', { key, value });
  }
}

export const otelTracer = new OpenTelemetryTracer();

// Trace context propagation
export function injectTraceContext(context: TraceContext, headers: Record<string, string>): void {
  headers['x-trace-id'] = context.traceId;
  headers['x-span-id'] = context.spanId;
  if (context.parentSpanId) {
    headers['x-parent-span-id'] = context.parentSpanId;
  }
}

export function extractTraceContext(headers: Record<string, string>): TraceContext | null {
  const traceId = headers['x-trace-id'];
  const spanId = headers['x-span-id'];
  const parentSpanId = headers['x-parent-span-id'];

  if (!traceId || !spanId) {
    return null;
  }

  return {
    traceId,
    spanId,
    parentSpanId,
  };
}
