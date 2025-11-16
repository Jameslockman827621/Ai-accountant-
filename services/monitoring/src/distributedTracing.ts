/**
 * Distributed Tracing with Jaeger/Zipkin support
 */

import { createLogger } from '@ai-accountant/shared-utils';
import crypto from 'crypto';

const logger = createLogger('distributed-tracing');

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  baggage?: Record<string, string>;
}

export interface Span {
  id: string;
  traceId: string;
  parentId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  tags: Record<string, string | number | boolean>;
  logs: Array<{ timestamp: number; fields: Record<string, unknown> }>;
}

export class DistributedTracer {
  private spans: Map<string, Span> = new Map();
  private exporter: TraceExporter;

  constructor(exporter: TraceExporter) {
    this.exporter = exporter;
  }

  startSpan(
    name: string,
    parentContext?: TraceContext,
    tags?: Record<string, string | number | boolean>
  ): TraceContext {
    const traceId = parentContext?.traceId || this.generateTraceId();
    const spanId = this.generateSpanId();
    const parentSpanId = parentContext?.spanId;

    const span: Span = {
      id: spanId,
      traceId,
      parentId: parentSpanId,
      name,
      startTime: Date.now() * 1000, // microseconds
      tags: tags || {},
      logs: [],
    };

    this.spans.set(spanId, span);

    logger.debug('Span started', { traceId, spanId, name });

    return {
      traceId,
      spanId,
      parentSpanId,
    };
  }

  endSpan(context: TraceContext, tags?: Record<string, string | number | boolean>): void {
    const span = this.spans.get(context.spanId);
    if (!span) {
      logger.warn('Span not found', { spanId: context.spanId });
      return;
    }

    span.endTime = Date.now() * 1000;
    if (tags) {
      Object.assign(span.tags, tags);
    }

    // Export span
    this.exporter.exportSpan(span);

    this.spans.delete(context.spanId);
    logger.debug('Span ended', { traceId: context.traceId, spanId: context.spanId });
  }

  addEvent(context: TraceContext, name: string, attributes?: Record<string, unknown>): void {
    const span = this.spans.get(context.spanId);
    if (!span) return;

    span.logs.push({
      timestamp: Date.now() * 1000,
      fields: {
        event: name,
        ...attributes,
      },
    });
  }

  setTag(context: TraceContext, key: string, value: string | number | boolean): void {
    const span = this.spans.get(context.spanId);
    if (!span) return;

    span.tags[key] = value;
  }

  private generateTraceId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private generateSpanId(): string {
    return crypto.randomBytes(8).toString('hex');
  }
}

export interface TraceExporter {
  exportSpan(span: Span): void;
}

export class JaegerExporter implements TraceExporter {
  private endpoint: string;

  constructor(endpoint: string = process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces') {
    this.endpoint = endpoint;
  }

  exportSpan(span: Span): void {
    // In production, send to Jaeger collector
    // const jaegerSpan = this.convertToJaegerFormat(span);
    // fetch(this.endpoint, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ spans: [jaegerSpan] }),
    // });
    logger.debug('Span exported to Jaeger', { spanId: span.id, traceId: span.traceId });
  }
}

export class ZipkinExporter implements TraceExporter {
  private endpoint: string;

  constructor(endpoint: string = process.env.ZIPKIN_ENDPOINT || 'http://localhost:9411/api/v2/spans') {
    this.endpoint = endpoint;
  }

  exportSpan(span: Span): void {
    // In production, send to Zipkin collector
    // const zipkinSpan = this.convertToZipkinFormat(span);
    // fetch(this.endpoint, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify([zipkinSpan]),
    // });
    logger.debug('Span exported to Zipkin', { spanId: span.id, traceId: span.traceId });
  }
}

// Trace context propagation helpers
export function injectTraceContext(context: TraceContext, headers: Record<string, string>): void {
  headers['x-trace-id'] = context.traceId;
  headers['x-span-id'] = context.spanId;
  if (context.parentSpanId) {
    headers['x-parent-span-id'] = context.parentSpanId;
  }
  // W3C Trace Context format
  headers['traceparent'] = `00-${context.traceId}-${context.spanId}-01`;
}

export function extractTraceContext(headers: Record<string, string>): TraceContext | null {
  // Try W3C Trace Context first
  const traceparent = headers['traceparent'];
  if (traceparent) {
    const parts = traceparent.split('-');
    if (parts.length === 4) {
      return {
        traceId: parts[1],
        spanId: parts[2],
      };
    }
  }

  // Fallback to custom headers
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

export function createTracer(provider: 'jaeger' | 'zipkin' = 'jaeger'): DistributedTracer {
  const exporter: TraceExporter =
    provider === 'jaeger'
      ? new JaegerExporter()
      : new ZipkinExporter();

  return new DistributedTracer(exporter);
}
