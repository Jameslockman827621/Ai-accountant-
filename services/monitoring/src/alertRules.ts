/**
 * Alert Rules Definitions
 * Defines SLO-based alert rules with runbooks
 */

import { alertingService } from './alerts';
import { db } from '@ai-accountant/database';

// SLO thresholds
const SLO_THRESHOLDS = {
  requestP95Latency: 500, // ms
  extractionAccuracy: 0.95, // 95%
  reconciliationSLA: 0.98, // 98%
  filingReadiness: 0.90, // 90%
  assistantConfidence: 0.85, // 85%
  errorRate: 0.01, // 1%
  dbQueryP95: 100, // ms
};

/**
 * Register all alert rules
 */
export function registerAlertRules() {
  // High error rate
  alertingService.registerRule({
    name: 'high_error_rate',
    condition: async () => {
      const result = await db.query<{ error_rate: number }>(
        `SELECT 
          COUNT(*) FILTER (WHERE status_code >= 400)::float / NULLIF(COUNT(*), 0) as error_rate
         FROM http_metrics
         WHERE timestamp > NOW() - INTERVAL '5 minutes'`
      );
      const errorRate = parseFloat(result.rows[0]?.error_rate || '0');
      return errorRate > SLO_THRESHOLDS.errorRate;
    },
    severity: 'critical',
    runbook: 'https://docs.example.com/runbooks/high-error-rate',
    cooldown: 300, // 5 minutes
  });

  // High request latency
  alertingService.registerRule({
    name: 'high_request_latency',
    condition: async () => {
      const result = await db.query<{ p95_latency: number }>(
        `SELECT 
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_latency
         FROM http_metrics
         WHERE timestamp > NOW() - INTERVAL '5 minutes'`
      );
      const p95Latency = parseFloat(result.rows[0]?.p95_latency || '0');
      return p95Latency > SLO_THRESHOLDS.requestP95Latency;
    },
    severity: 'warning',
    runbook: 'https://docs.example.com/runbooks/high-latency',
    cooldown: 600, // 10 minutes
  });

  // Low extraction accuracy
  alertingService.registerRule({
    name: 'low_extraction_accuracy',
    condition: async () => {
      const result = await db.query<{ avg_accuracy: number }>(
        `SELECT AVG(accuracy_score) as avg_accuracy
         FROM extraction_metrics
         WHERE timestamp > NOW() - INTERVAL '15 minutes'`
      );
      const avgAccuracy = parseFloat(result.rows[0]?.avg_accuracy || '1');
      return avgAccuracy < SLO_THRESHOLDS.extractionAccuracy;
    },
    severity: 'warning',
    runbook: 'https://docs.example.com/runbooks/extraction-accuracy',
    cooldown: 900, // 15 minutes
  });

  // Low reconciliation SLA
  alertingService.registerRule({
    name: 'low_reconciliation_sla',
    condition: async () => {
      const result = await db.query<{ avg_sla: number }>(
        `SELECT AVG(sla_score) as avg_sla
         FROM reconciliation_metrics
         WHERE timestamp > NOW() - INTERVAL '30 minutes'`
      );
      const avgSLA = parseFloat(result.rows[0]?.avg_sla || '1');
      return avgSLA < SLO_THRESHOLDS.reconciliationSLA;
    },
    severity: 'warning',
    runbook: 'https://docs.example.com/runbooks/reconciliation-sla',
    cooldown: 1800, // 30 minutes
  });

  // Database connection pool exhaustion
  alertingService.registerRule({
    name: 'db_connection_pool_exhausted',
    condition: async () => {
      const result = await db.query<{ active_connections: number; max_connections: number }>(
        `SELECT 
          COUNT(*) as active_connections,
          current_setting('max_connections')::int as max_connections
         FROM pg_stat_activity
         WHERE datname = current_database()`
      );
      const row = result.rows[0];
      const utilization = (row?.active_connections || 0) / (row?.max_connections || 100);
      return utilization > 0.9; // 90% utilization
    },
    severity: 'critical',
    runbook: 'https://docs.example.com/runbooks/db-connections',
    cooldown: 300,
  });

  // High queue depth
  alertingService.registerRule({
    name: 'high_queue_depth',
    condition: async () => {
      // This would query the message queue
      // For now, return false as placeholder
      return false;
    },
    severity: 'warning',
    runbook: 'https://docs.example.com/runbooks/queue-depth',
    cooldown: 300,
  });

  // Security anomaly detection
  alertingService.registerRule({
    name: 'security_anomaly',
    condition: async () => {
      const result = await db.query<{ anomaly_count: string }>(
        `SELECT COUNT(*) as anomaly_count
         FROM security_events
         WHERE event_type IN ('unauthorized_access', 'suspicious_activity', 'rate_limit_exceeded')
           AND timestamp > NOW() - INTERVAL '5 minutes'`
      );
      const count = parseInt(result.rows[0]?.anomaly_count || '0', 10);
      return count > 10; // More than 10 security events in 5 minutes
    },
    severity: 'critical',
    runbook: 'https://docs.example.com/runbooks/security-anomaly',
    cooldown: 60, // 1 minute
  });
}
