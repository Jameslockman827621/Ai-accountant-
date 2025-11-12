import { randomUUID } from 'crypto';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';

const logger = createLogger('monitoring-service');

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  serviceName: string;
  operationName: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  tags: Record<string, string>;
  logs: Array<{ timestamp: Date; message: string }>;
}

class TracingService {
  private activeSpans: Map<string, TraceSpan> = new Map();

  startSpan(
    serviceName: string,
    operationName: string,
    parentSpanId?: string,
    traceId?: string
  ): string {
    const spanId = randomUUID();
    const finalTraceId = traceId || randomUUID();

    const span: TraceSpan = {
      traceId: finalTraceId,
      spanId,
      parentSpanId,
      serviceName,
      operationName,
      startTime: new Date(),
      tags: {},
      logs: [],
    };

    this.activeSpans.set(spanId, span);

    return spanId;
  }

  endSpan(spanId: string): void {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      logger.warn('Span not found', { spanId });
      return;
    }

    span.endTime = new Date();
    span.duration = span.endTime.getTime() - span.startTime.getTime();

    // Store trace
    this.storeTrace(span).catch(err => {
      logger.error('Failed to store trace', err instanceof Error ? err : new Error(String(err)));
    });

    this.activeSpans.delete(spanId);
  }

  addTag(spanId: string, key: string, value: string): void {
    const span = this.activeSpans.get(spanId);
    if (span) {
      span.tags[key] = value;
    }
  }

  addLog(spanId: string, message: string): void {
    const span = this.activeSpans.get(spanId);
    if (span) {
      span.logs.push({
        timestamp: new Date(),
        message,
      });
    }
  }

  private async storeTrace(span: TraceSpan): Promise<void> {
    await db.query(
      `INSERT INTO traces (
        trace_id, span_id, parent_span_id, service_name, operation_name,
        start_time, end_time, duration, tags, logs
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)`,
      [
        span.traceId,
        span.spanId,
        span.parentSpanId || null,
        span.serviceName,
        span.operationName,
        span.startTime,
        span.endTime,
        span.duration,
        JSON.stringify(span.tags),
        JSON.stringify(span.logs),
      ]
    );
  }

  getTrace(traceId: string): Promise<TraceSpan[]> {
    return db.query<TraceSpan>(
      'SELECT * FROM traces WHERE trace_id = $1 ORDER BY start_time',
      [traceId]
    ).then(result => result.rows);
  }
}

export const tracingService = new TracingService();
