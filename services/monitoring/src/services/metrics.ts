import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';

const logger = createLogger('monitoring-service');

export interface Metric {
  name: string;
  value: number;
  tags: Record<string, string>;
  timestamp: Date;
}

export interface ServiceMetrics {
  serviceName: string;
  requestCount: number;
  errorCount: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
}

class MetricsCollector {
  private metrics: Metric[] = [];
  private readonly maxMetrics = 10000;

  recordMetric(metric: Metric): void {
    this.metrics.push(metric);

    // Keep only recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Store in database for persistence
    this.storeMetric(metric).catch(err => {
      logger.error('Failed to store metric', err instanceof Error ? err : new Error(String(err)));
    });
  }

  private async storeMetric(metric: Metric): Promise<void> {
    await db.query(
      `INSERT INTO metrics (name, value, tags, timestamp)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [metric.name, metric.value, JSON.stringify(metric.tags), metric.timestamp]
    );
  }

  getMetrics(serviceName?: string, startTime?: Date, endTime?: Date): Metric[] {
    let filtered = this.metrics;

    if (serviceName) {
      filtered = filtered.filter(m => m.tags.service === serviceName);
    }

    if (startTime) {
      filtered = filtered.filter(m => m.timestamp >= startTime);
    }

    if (endTime) {
      filtered = filtered.filter(m => m.timestamp <= endTime);
    }

    return filtered;
  }

  getServiceMetrics(serviceName: string, timeWindow: number = 3600000): ServiceMetrics {
    const now = new Date();
    const startTime = new Date(now.getTime() - timeWindow);

    const serviceMetrics = this.getMetrics(serviceName, startTime, now);

    const requestMetrics = serviceMetrics.filter(m => m.name === 'http_request');
    const errorMetrics = serviceMetrics.filter(m => m.name === 'http_error');

    const responseTimes = requestMetrics
      .map(m => m.value)
      .sort((a, b) => a - b);

    const averageResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    const p95Index = Math.floor(responseTimes.length * 0.95);
    const p99Index = Math.floor(responseTimes.length * 0.99);

    return {
      serviceName,
      requestCount: requestMetrics.length,
      errorCount: errorMetrics.length,
      averageResponseTime,
      p95ResponseTime: responseTimes[p95Index] || 0,
      p99ResponseTime: responseTimes[p99Index] || 0,
    };
  }
}

export const metricsCollector = new MetricsCollector();

export function recordRequest(serviceName: string, method: string, path: string, statusCode: number, duration: number): void {
  metricsCollector.recordMetric({
    name: 'http_request',
    value: duration,
    tags: {
      service: serviceName,
      method,
      path,
      status: String(statusCode),
    },
    timestamp: new Date(),
  });

  if (statusCode >= 400) {
    metricsCollector.recordMetric({
      name: 'http_error',
      value: 1,
      tags: {
        service: serviceName,
        method,
        path,
        status: String(statusCode),
      },
      timestamp: new Date(),
    });
  }
}

export function recordDatabaseQuery(serviceName: string, query: string, duration: number): void {
  metricsCollector.recordMetric({
    name: 'database_query',
    value: duration,
    tags: {
      service: serviceName,
      query: query.substring(0, 50),
    },
    timestamp: new Date(),
  });
}

export function recordExternalAPICall(serviceName: string, apiName: string, duration: number, success: boolean): void {
  metricsCollector.recordMetric({
    name: 'external_api_call',
    value: duration,
    tags: {
      service: serviceName,
      api: apiName,
      success: String(success),
    },
    timestamp: new Date(),
  });
}

export function recordQueueLagMetric(serviceName: string, queue: string, lagSeconds: number): void {
  metricsCollector.recordMetric({
    name: 'queue_lag_seconds',
    value: lagSeconds,
    tags: { service: serviceName, queue },
    timestamp: new Date(),
  });
}

export function recordOcrThroughputMetric(
  serviceName: string,
  documentsProcessed: number,
  durationMs: number
): void {
  const minutes = Math.max(durationMs / 60000, 0.001);
  const throughputPerMinute = documentsProcessed / minutes;

  metricsCollector.recordMetric({
    name: 'ocr_throughput_per_minute',
    value: throughputPerMinute,
    tags: { service: serviceName },
    timestamp: new Date(),
  });
}

export function recordFilingResult(
  serviceName: string,
  success: boolean,
  filingType?: string
): void {
  metricsCollector.recordMetric({
    name: 'filing_result',
    value: success ? 1 : 0,
    tags: { service: serviceName, filingType: filingType || 'generic' },
    timestamp: new Date(),
  });
}
