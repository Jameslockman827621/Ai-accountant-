import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { sendEmail } from '../../notification/src/services/email';

const logger = createLogger('monitoring-service');

export interface AlertRule {
  id: string;
  tenantId: string;
  name: string;
  metric: string;
  condition: 'greater_than' | 'less_than' | 'equals' | 'not_equals';
  threshold: number;
  severity: 'critical' | 'warning' | 'info';
  recipients: string[];
  isActive: boolean;
}

export interface Alert {
  id: string;
  ruleId: string;
  tenantId: string;
  severity: AlertRule['severity'];
  message: string;
  metricValue: number;
  threshold: number;
  timestamp: Date;
  acknowledged: boolean;
}

/**
 * Check alert rules and trigger alerts
 */
export async function checkAlerts(tenantId: string): Promise<Alert[]> {
  const rules = await db.query<{
    id: string;
    tenant_id: string;
    name: string;
    metric: string;
    condition: string;
    threshold: number;
    severity: string;
    recipients: unknown;
  }>(
    'SELECT * FROM alert_rules WHERE tenant_id = $1 AND is_active = true',
    [tenantId]
  );

  const triggeredAlerts: Alert[] = [];

  for (const rule of rules.rows) {
    const metricValue = await getMetricValue(tenantId, rule.metric);
    const shouldAlert = evaluateCondition(metricValue, rule.condition, rule.threshold);

    if (shouldAlert) {
      const alert = await createAlert({
        ruleId: rule.id,
        tenantId: rule.tenant_id,
        severity: rule.severity as AlertRule['severity'],
        message: `${rule.name}: ${rule.metric} is ${rule.condition} ${rule.threshold} (current: ${metricValue})`,
        metricValue,
        threshold: rule.threshold,
      });

      triggeredAlerts.push(alert);

      // Send notifications
      const recipients = rule.recipients as string[] || [];
      for (const recipient of recipients) {
        await sendEmail(
          recipient,
          `Alert: ${rule.name}`,
          alert.message
        ).catch(err => logger.error('Failed to send alert email', err));
      }
    }
  }

  return triggeredAlerts;
}

async function getMetricValue(tenantId: string, metric: string): Promise<number> {
  // Get metric from monitoring system
  // Simplified - in production would query Prometheus/CloudWatch/etc
  switch (metric) {
    case 'error_rate':
      const errors = await db.query<{ count: string | number }>(
        `SELECT COUNT(*) as count FROM error_records
         WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
        [tenantId]
      );
      return typeof errors.rows[0]?.count === 'number' 
        ? errors.rows[0].count 
        : parseInt(String(errors.rows[0]?.count || '0'), 10);
    case 'pending_reviews':
      const reviews = await db.query<{ count: string | number }>(
        `SELECT COUNT(*) as count FROM review_tasks
         WHERE tenant_id = $1 AND status = 'pending'`,
        [tenantId]
      );
      return typeof reviews.rows[0]?.count === 'number'
        ? reviews.rows[0].count
        : parseInt(String(reviews.rows[0]?.count || '0'), 10);
    default:
      return 0;
  }
}

function evaluateCondition(value: number, condition: string, threshold: number): boolean {
  switch (condition) {
    case 'greater_than':
      return value > threshold;
    case 'less_than':
      return value < threshold;
    case 'equals':
      return value === threshold;
    case 'not_equals':
      return value !== threshold;
    default:
      return false;
  }
}

async function createAlert(alert: Omit<Alert, 'id' | 'timestamp' | 'acknowledged'>): Promise<Alert> {
  const alertId = crypto.randomUUID();
  const timestamp = new Date();

  await db.query(
    `INSERT INTO alerts (
      id, rule_id, tenant_id, severity, message, metric_value, threshold, timestamp, acknowledged, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, NOW())`,
    [alertId, alert.ruleId, alert.tenantId, alert.severity, alert.message, alert.metricValue, alert.threshold, timestamp]
  );

  return {
    id: alertId,
    ...alert,
    timestamp,
    acknowledged: false,
  };
}
