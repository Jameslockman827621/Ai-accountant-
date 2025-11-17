/**
 * Alerting Service
 * Defines alert rules and integrates with PagerDuty/other alerting systems
 */

import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('alerts');

export interface AlertRule {
  name: string;
  condition: () => Promise<boolean>;
  severity: 'critical' | 'warning' | 'info';
  runbook: string;
  cooldown?: number; // seconds
}

export interface Alert {
  id: string;
  rule: string;
  severity: string;
  message: string;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
}

class AlertingService {
  private alerts: Map<string, Alert> = new Map();
  private lastFired: Map<string, number> = new Map();
  private rules: AlertRule[] = [];

  /**
   * Register an alert rule
   */
  registerRule(rule: AlertRule) {
    this.rules.push(rule);
  }

  /**
   * Evaluate all alert rules
   */
  async evaluateRules() {
    for (const rule of this.rules) {
      try {
        const shouldFire = await rule.condition();
        const now = Date.now();
        const lastFiredTime = this.lastFired.get(rule.name) || 0;
        const cooldown = (rule.cooldown || 300) * 1000; // Default 5 minutes

        if (shouldFire && now - lastFiredTime > cooldown) {
          await this.fireAlert(rule, `Alert condition met: ${rule.name}`);
          this.lastFired.set(rule.name, now);
        }
      } catch (error) {
        logger.error(`Error evaluating alert rule ${rule.name}`, error);
      }
    }
  }

  /**
   * Fire an alert
   */
  private async fireAlert(rule: AlertRule, message: string) {
    const alert: Alert = {
      id: `${rule.name}-${Date.now()}`,
      rule: rule.name,
      severity: rule.severity,
      message,
      timestamp: new Date(),
      resolved: false,
    };

    this.alerts.set(alert.id, alert);

    // Send to PagerDuty or other alerting system
    await this.sendToPagerDuty(alert, rule);

    logger.warn('Alert fired', {
      alertId: alert.id,
      rule: rule.name,
      severity: rule.severity,
      message,
    });
  }

  /**
   * Send alert to PagerDuty
   */
  private async sendToPagerDuty(alert: Alert, rule: AlertRule) {
    const pagerDutyKey = process.env.PAGERDUTY_INTEGRATION_KEY;
    if (!pagerDutyKey) {
      logger.warn('PagerDuty integration key not configured');
      return;
    }

    try {
      const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          routing_key: pagerDutyKey,
          event_action: 'trigger',
          payload: {
            summary: `${rule.name}: ${alert.message}`,
            severity: rule.severity === 'critical' ? 'critical' : 'warning',
            source: 'ai-accountant-monitoring',
            custom_details: {
              alertId: alert.id,
              rule: rule.name,
              runbook: rule.runbook,
              timestamp: alert.timestamp.toISOString(),
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`PagerDuty API error: ${response.statusText}`);
      }
    } catch (error) {
      logger.error('Failed to send alert to PagerDuty', error);
    }
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string) {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = new Date();
      this.alerts.set(alertId, alert);
    }
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter((a) => !a.resolved);
  }
}

export const alertingService = new AlertingService();

// Start evaluating rules periodically
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    alertingService.evaluateRules();
  }, 60000); // Every minute
}
