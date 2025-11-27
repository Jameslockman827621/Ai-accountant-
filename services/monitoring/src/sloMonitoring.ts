/**
 * SLO (Service Level Objective) Monitoring
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';

const logger = createLogger('slo-monitoring');

export interface SLO {
  id: string;
  name: string;
  description: string;
  target: number; // 0-1 (e.g., 0.99 for 99%)
  window: number; // in seconds
  metric: string;
  service: string;
}

export interface SLOResult {
  sloId: string;
  currentValue: number; // 0-1
  target: number;
  status: 'meeting' | 'at_risk' | 'breached';
  errorBudget: number; // remaining error budget
  errorBudgetConsumed: number; // 0-1
  windowStart: Date;
  windowEnd: Date;
}

// Default SLOs
const DEFAULT_SLOS: SLO[] = [
  {
    id: 'slo-availability',
    name: 'Service Availability',
    description: '99.9% uptime',
    target: 0.999,
    window: 30 * 24 * 3600, // 30 days
    metric: 'availability',
    service: 'all',
  },
  {
    id: 'slo-latency-p95',
    name: 'P95 Latency',
    description: '95% of requests under 500ms',
    target: 0.95,
    window: 7 * 24 * 3600, // 7 days
    metric: 'latency_p95',
    service: 'api-gateway',
  },
  {
    id: 'slo-error-rate',
    name: 'Error Rate',
    description: 'Less than 0.1% error rate',
    target: 0.999, // 99.9% success rate
    window: 7 * 24 * 3600,
    metric: 'error_rate',
    service: 'all',
  },
  {
    id: 'slo-document-processing',
    name: 'Document Processing Time',
    description: '90% of documents processed within 5 minutes',
    target: 0.90,
    window: 24 * 3600, // 1 day
    metric: 'document_processing_time',
    service: 'document-ingest',
  },
  {
    id: 'slo-queue-lag',
    name: 'Queue Lag Compliance',
    description: '95% of queue events under 2 minutes of lag',
    target: 0.95,
    window: 6 * 3600, // 6 hours
    metric: 'queue_lag',
    service: 'all',
  },
  {
    id: 'slo-ocr-throughput',
    name: 'OCR Throughput',
    description: 'Keep OCR throughput above 30 docs/minute across tenants',
    target: 0.90,
    window: 3600, // hourly
    metric: 'ocr_throughput',
    service: 'ocr',
  },
  {
    id: 'slo-filing-success',
    name: 'Filing Success Rate',
    description: '98% of filings complete without error',
    target: 0.98,
    window: 24 * 3600, // 1 day
    metric: 'filing_success',
    service: 'filing',
  },
  {
    id: 'slo-trace-export',
    name: 'Trace Export Success',
    description: '95% of traces successfully exported to the collector',
    target: 0.95,
    window: 3600, // 1 hour
    metric: 'trace_export_success',
    service: 'all',
  },
];

export class SLOMonitor {
  private slos: Map<string, SLO> = new Map();

  constructor(slos: SLO[] = DEFAULT_SLOS) {
    for (const slo of slos) {
      this.slos.set(slo.id, slo);
    }
  }

  getSLODefinition(sloId: string): SLO | undefined {
    return this.slos.get(sloId);
  }

  async evaluateSLO(sloId: string): Promise<SLOResult | null> {
    const slo = this.slos.get(sloId);
    if (!slo) {
      logger.warn('SLO not found', { sloId });
      return null;
    }

    const windowStart = new Date(Date.now() - slo.window * 1000);
    const windowEnd = new Date();

    const currentValue = await this.getMetricValue(slo, windowStart, windowEnd);
    const status = this.determineStatus(currentValue, slo.target);
    const errorBudget = 1 - slo.target;
    const errorBudgetConsumed = Math.max(0, (slo.target - currentValue) / errorBudget);

    return {
      sloId,
      currentValue,
      target: slo.target,
      status,
      errorBudget,
      errorBudgetConsumed,
      windowStart,
      windowEnd,
    };
  }

  async evaluateAllSLOs(): Promise<SLOResult[]> {
    const results: SLOResult[] = [];

    for (const sloId of this.slos.keys()) {
      const result = await this.evaluateSLO(sloId);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  private async getMetricValue(slo: SLO, start: Date, end: Date): Promise<number> {
    switch (slo.metric) {
      case 'availability':
        return await this.getAvailability(slo.service, start, end);
      case 'latency_p95':
        return await this.getLatencyP95(slo.service, start, end);
      case 'error_rate':
        return await this.getSuccessRate(slo.service, start, end);
      case 'document_processing_time':
        return await this.getDocumentProcessingCompliance(slo.service, start, end);
      case 'queue_lag':
        return await this.getQueueLagCompliance(slo.service, start, end);
      case 'ocr_throughput':
        return await this.getOcrThroughputCompliance(start, end);
      case 'filing_success':
        return await this.getFilingSuccessRate(start, end);
      case 'trace_export_success':
        return await this.getTraceExportSuccess(start, end);
      default:
        logger.warn('Unknown metric', { metric: slo.metric });
        return 0;
    }
  }

  private async getAvailability(service: string, start: Date, end: Date): Promise<number> {
    // Query health check data
    const result = await db.query<{ uptime: number }>(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'healthy')::float / NULLIF(COUNT(*), 0) as uptime
       FROM health_checks
       WHERE service = $1 AND checked_at BETWEEN $2 AND $3`,
      [service === 'all' ? '%' : service, start, end]
    );

    return result.rows[0]?.uptime || 1.0;
  }

  private async getLatencyP95(service: string, start: Date, end: Date): Promise<number> {
    // Query metrics for P95 latency compliance
    const result = await db.query<{ compliance: number }>(
      `SELECT 
        COUNT(*) FILTER (WHERE response_time <= 500)::float / NULLIF(COUNT(*), 0) as compliance
       FROM request_metrics
       WHERE service = $1 AND timestamp BETWEEN $2 AND $3`,
      [service, start, end]
    );

    return result.rows[0]?.compliance || 1.0;
  }

  private async getSuccessRate(service: string, start: Date, end: Date): Promise<number> {
    const result = await db.query<{ success_rate: number }>(
      `SELECT 
        COUNT(*) FILTER (WHERE status_code < 500)::float / NULLIF(COUNT(*), 0) as success_rate
       FROM request_metrics
       WHERE service = $1 AND timestamp BETWEEN $2 AND $3`,
      [service === 'all' ? '%' : service, start, end]
    );

    return result.rows[0]?.success_rate || 1.0;
  }

  private async getDocumentProcessingCompliance(service: string, start: Date, end: Date): Promise<number> {
    const result = await db.query<{ compliance: number }>(
      `SELECT 
        COUNT(*) FILTER (WHERE processing_time <= 300)::float / NULLIF(COUNT(*), 0) as compliance
       FROM document_processing_metrics
       WHERE service = $1 AND completed_at BETWEEN $2 AND $3`,
      [service, start, end]
    );

    return result.rows[0]?.compliance || 1.0;
  }

  private async getQueueLagCompliance(service: string, start: Date, end: Date): Promise<number> {
    const result = await db.query<{ compliance: number }>(
      `SELECT
        COUNT(*) FILTER (WHERE value <= 120)::float / NULLIF(COUNT(*), 0) as compliance
       FROM metrics
       WHERE name = 'queue_lag_seconds'
         AND (tags->>'service' = $1 OR $1 = 'all')
         AND timestamp BETWEEN $2 AND $3`,
      [service, start, end]
    );

    return result.rows[0]?.compliance || 1.0;
  }

  private async getOcrThroughputCompliance(start: Date, end: Date): Promise<number> {
    const expectedThroughput = 30; // docs/minute target for capacity planning
    const result = await db.query<{ avg_throughput: number }>(
      `SELECT AVG(value) as avg_throughput
       FROM metrics
       WHERE name = 'ocr_throughput_per_minute'
         AND timestamp BETWEEN $1 AND $2`,
      [start, end]
    );

    const avg = result.rows[0]?.avg_throughput || expectedThroughput;
    const ratio = avg / expectedThroughput;
    return Math.min(ratio, 1);
  }

  private async getFilingSuccessRate(start: Date, end: Date): Promise<number> {
    const result = await db.query<{ success_rate: number }>(
      `SELECT AVG(value)::float as success_rate
       FROM metrics
       WHERE name = 'filing_result'
         AND timestamp BETWEEN $1 AND $2`,
      [start, end]
    );

    return result.rows[0]?.success_rate || 1.0;
  }

  private async getTraceExportSuccess(start: Date, end: Date): Promise<number> {
    const result = await db.query<{ success_rate: number }>(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'success')::float / NULLIF(COUNT(*), 0) as success_rate
       FROM telemetry_exports
       WHERE pipeline = 'traces' AND exported_at BETWEEN $1 AND $2`,
      [start, end]
    );

    return result.rows[0]?.success_rate || 1.0;
  }

  private determineStatus(currentValue: number, target: number): 'meeting' | 'at_risk' | 'breached' {
    if (currentValue >= target) {
      return 'meeting';
    } else if (currentValue >= target * 0.95) {
      return 'at_risk';
    } else {
      return 'breached';
    }
  }

  addSLO(slo: SLO): void {
    this.slos.set(slo.id, slo);
  }

  removeSLO(sloId: string): void {
    this.slos.delete(sloId);
  }
}

export const sloMonitor = new SLOMonitor();
