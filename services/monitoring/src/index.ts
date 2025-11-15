import express, { Express } from 'express';
import crypto from 'crypto';
import { createLogger } from '@ai-accountant/shared-utils';
import { getQueueHealth } from './services/queueMetrics';

const logger = createLogger('monitoring-service');

// Prometheus metrics collection
export class MetricsCollector {
  private metrics: Map<string, number> = new Map();
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  incrementCounter(name: string, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + 1);
  }

  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    const values = this.histograms.get(key) || [];
    values.push(value);
    this.histograms.set(key, values);
  }

  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    this.metrics.set(key, value);
  }

  private buildKey(name: string, labels?: Record<string, string>): string {
    if (!labels) return name;
    const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',');
    return `${name}{${labelStr}}`;
  }

  getPrometheusFormat(): string {
    const lines: string[] = [];

    // Counters
    for (const [key, value] of this.counters) {
      lines.push(`${key} ${value}`);
    }

    // Gauges
    for (const [key, value] of this.metrics) {
      lines.push(`${key} ${value}`);
    }

    // Histograms
    for (const [key, values] of this.histograms) {
      const sum = values.reduce((a, b) => a + b, 0);
      const count = values.length;
      const avg = count > 0 ? sum / count : 0;
      lines.push(`${key}_sum ${sum}`);
      lines.push(`${key}_count ${count}`);
      lines.push(`${key}_avg ${avg}`);
    }

    return lines.join('\n');
  }
}

export const metricsCollector = new MetricsCollector();

// Distributed tracing
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export class Tracer {
  private traces: Map<string, TraceContext[]> = new Map();

  startTrace(operation: string, parentContext?: TraceContext): TraceContext {
    const traceId = parentContext?.traceId || crypto.randomUUID();
    const spanId = crypto.randomUUID();
    const context: TraceContext = parentContext?.spanId
      ? { traceId, spanId, parentSpanId: parentContext.spanId }
      : { traceId, spanId };

    const traces = this.traces.get(traceId) || [];
    traces.push(context);
    this.traces.set(traceId, traces);

    logger.info('Trace started', { operation, traceId, spanId });
    return context;
  }

  endTrace(context: TraceContext, operation: string, duration: number): void {
    metricsCollector.recordHistogram('trace_duration_seconds', duration / 1000, {
      operation,
      trace_id: context.traceId,
    });
    logger.info('Trace ended', { operation, traceId: context.traceId, duration });
  }

  getTrace(traceId: string): TraceContext[] {
    return this.traces.get(traceId) || [];
  }
}

export const tracer = new Tracer();

// Health check with dependencies
export async function checkHealth(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  dependencies: Record<string, { status: 'ok' | 'error'; message?: string }>;
}> {
  const dependencies: Record<string, { status: 'ok' | 'error'; message?: string }> = {};

  // Check database
  try {
    const { db } = await import('@ai-accountant/database');
    await db.query('SELECT 1');
    dependencies.database = { status: 'ok' };
  } catch (error) {
    dependencies.database = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Database connection failed',
    };
  }

  // Check Redis
  try {
    const redis = require('redis');
    const client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    await client.connect();
    await client.ping();
    await client.quit();
    dependencies.redis = { status: 'ok' };
  } catch (error) {
    dependencies.redis = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Redis connection failed',
    };
  }

  // Check RabbitMQ
  try {
    const amqp = require('amqplib');
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost:5672');
    await connection.close();
    dependencies.rabbitmq = { status: 'ok' };
  } catch (error) {
    dependencies.rabbitmq = {
      status: 'error',
      message: error instanceof Error ? error.message : 'RabbitMQ connection failed',
    };
  }

  const hasErrors = Object.values(dependencies).some(dep => dep.status === 'error');
  const status = hasErrors ? 'degraded' : 'healthy';

  return {
    status,
    timestamp: new Date().toISOString(),
    dependencies,
  };
}

// Health check endpoint
export function createMonitoringApp(): Express {
  const app = express();

  app.get('/health', async (_req, res) => {
    const health = await checkHealth();
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  app.get('/metrics', (_req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(metricsCollector.getPrometheusFormat());
  });

  app.get('/traces/:traceId', (req, res) => {
    const traces = tracer.getTrace(req.params.traceId);
    res.json({ traceId: req.params.traceId, spans: traces });
  });

  app.get('/queues/health', (_req, res) => {
    res.json({ queues: getQueueHealth() });
  });

  return app;
}

// Start server if this file is run directly
if (require.main === module) {
  const { config } = require('dotenv');
  config();

  const app = createMonitoringApp();
  const PORT = process.env.PORT || 3019;

  app.listen(PORT, () => {
    logger.info(`Monitoring service listening on port ${PORT}`);
  });
}
