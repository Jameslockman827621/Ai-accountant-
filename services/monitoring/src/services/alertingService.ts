import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { randomUUID } from 'crypto';

const logger = createLogger('alerting-service');

export interface AlertRule {
  id: string;
  ruleName: string;
  serviceName: string | null;
  metricName: string;
  conditionType: 'threshold' | 'rate_of_change' | 'anomaly';
  conditionConfig: Record<string, unknown>;
  severity: 'info' | 'warning' | 'critical';
  notificationChannels: string[];
  runbookUrl: string | null;
  enabled: boolean;
}

export interface AlertFire {
  id: string;
  alertRuleId: string;
  firedAt: Date;
  resolvedAt: Date | null;
  status: 'firing' | 'resolved' | 'acknowledged';
  metricValue: number | null;
  thresholdValue: number | null;
  context: Record<string, unknown>;
}

/**
 * Alerting Service (Chunk 2)
 * Manages alert rules and fires
 */
export class AlertingService {
  /**
   * Evaluate alert rules and fire alerts if conditions met
   */
  async evaluateAlerts(serviceName: string, metricName: string, metricValue: number): Promise<void> {
    const rules = await this.getEnabledRules(serviceName, metricName);

    for (const rule of rules) {
      if (this.evaluateCondition(rule, metricValue)) {
        await this.fireAlert(rule, metricValue);
      }
    }
  }

  /**
   * Evaluate alert condition
   */
  private evaluateCondition(rule: AlertRule, metricValue: number): boolean {
    const config = rule.conditionConfig;

    switch (rule.conditionType) {
      case 'threshold':
        const threshold = config.threshold as number;
        const operator = (config.operator as string) || 'gt';
        if (operator === 'gt') {
          return metricValue > threshold;
        } else if (operator === 'lt') {
          return metricValue < threshold;
        } else if (operator === 'eq') {
          return metricValue === threshold;
        }
        return false;

      case 'rate_of_change':
        // Would need previous value to calculate rate
        return false;

      case 'anomaly':
        // Would use anomaly detection algorithm
        return false;

      default:
        return false;
    }
  }

  /**
   * Fire alert
   */
  private async fireAlert(rule: AlertRule, metricValue: number): Promise<void> {
    // Check if alert is already firing
    const existingFire = await db.query<{ id: string }>(
      `SELECT id FROM alert_fires
       WHERE alert_rule_id = $1 AND status = 'firing'
       ORDER BY fired_at DESC
       LIMIT 1`,
      [rule.id]
    );

    if (existingFire.rows.length > 0) {
      // Alert already firing, don't create duplicate
      return;
    }

    // Create alert fire
    const fireId = randomUUID();
    await db.query(
      `INSERT INTO alert_fires (
        id, alert_rule_id, fired_at, status, metric_value, threshold_value, context
      ) VALUES (
        $1, $2, NOW(), 'firing', $3, $4, $5::jsonb
      )`,
      [
        fireId,
        rule.id,
        metricValue,
        (rule.conditionConfig.threshold as number) || null,
        JSON.stringify({ serviceName: rule.serviceName, metricName: rule.metricName }),
      ]
    );

    // Send notifications
    await this.sendNotifications(rule, fireId, metricValue);

    logger.warn('Alert fired', {
      ruleId: rule.id,
      ruleName: rule.ruleName,
      severity: rule.severity,
      metricValue,
    });
  }

  /**
   * Send notifications
   */
  private async sendNotifications(rule: AlertRule, fireId: string, metricValue: number): Promise<void> {
    // In production, would send to Slack, PagerDuty, email, etc.
    for (const channel of rule.notificationChannels) {
      logger.info('Sending alert notification', {
        channel,
        ruleName: rule.ruleName,
        severity: rule.severity,
        runbookUrl: rule.runbookUrl,
      });
    }

    // Mark as sent
    await db.query(
      `UPDATE alert_fires
       SET notification_sent = true,
           notification_sent_at = NOW()
       WHERE id = $1`,
      [fireId]
    );
  }

  /**
   * Get enabled alert rules
   */
  private async getEnabledRules(serviceName: string | null, metricName: string): Promise<AlertRule[]> {
    let query = `SELECT * FROM alert_rules WHERE enabled = true AND metric_name = $1`;
    const params: unknown[] = [metricName];

    if (serviceName) {
      query += ` AND (service_name = $2 OR service_name IS NULL)`;
      params.push(serviceName);
    }

    const result = await db.query<{
      id: string;
      rule_name: string;
      service_name: string | null;
      metric_name: string;
      condition_type: string;
      condition_config: unknown;
      severity: string;
      notification_channels: unknown;
      runbook_url: string | null;
      enabled: boolean;
    }>(query, params);

    return result.rows.map(row => ({
      id: row.id,
      ruleName: row.rule_name,
      serviceName: row.service_name,
      metricName: row.metric_name,
      conditionType: row.condition_type as AlertRule['conditionType'],
      conditionConfig: (row.condition_config as Record<string, unknown>) || {},
      severity: row.severity as AlertRule['severity'],
      notificationChannels: (row.notification_channels as string[]) || [],
      runbookUrl: row.runbook_url,
      enabled: row.enabled,
    }));
  }

  /**
   * Resolve alert
   */
  async resolveAlert(fireId: string, resolvedBy: string, notes?: string): Promise<void> {
    await db.query(
      `UPDATE alert_fires
       SET status = 'resolved',
           resolved_at = NOW(),
           resolved_by = $1,
           resolution_notes = $2
       WHERE id = $3`,
      [resolvedBy, notes || null, fireId]
    );
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts(): Promise<AlertFire[]> {
    const result = await db.query<{
      id: string;
      alert_rule_id: string;
      fired_at: Date;
      resolved_at: Date | null;
      status: string;
      metric_value: number | null;
      threshold_value: number | null;
      context: unknown;
    }>(
      `SELECT * FROM alert_fires
       WHERE status = 'firing'
       ORDER BY fired_at DESC`
    );

    return result.rows.map(row => ({
      id: row.id,
      alertRuleId: row.alert_rule_id,
      firedAt: row.fired_at,
      resolvedAt: row.resolved_at,
      status: row.status as AlertFire['status'],
      metricValue: row.metric_value,
      thresholdValue: row.threshold_value,
      context: (row.context as Record<string, unknown>) || {},
    }));
  }
}

export const alertingService = new AlertingService();
