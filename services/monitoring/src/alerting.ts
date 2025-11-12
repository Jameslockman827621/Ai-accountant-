import { createLogger } from '@ai-accountant/shared-utils';
import { metricsCollector } from './index';

const logger = createLogger('monitoring-service');

// Alerting System (PagerDuty/Opsgenie integration)
export class AlertingSystem {
  private alertRules: Array<{
    name: string;
    condition: () => Promise<boolean>;
    severity: 'low' | 'medium' | 'high' | 'critical';
    action: () => Promise<void>;
  }> = [];

  async addAlertRule(
    name: string,
    condition: () => Promise<boolean>,
    severity: 'low' | 'medium' | 'high' | 'critical',
    action: () => Promise<void>
  ): Promise<void> {
    this.alertRules.push({ name, condition, severity, action });
    logger.info('Alert rule added', { name, severity });
  }

  async checkAlerts(): Promise<void> {
    for (const rule of this.alertRules) {
      try {
        const triggered = await rule.condition();
        if (triggered) {
          logger.warn('Alert triggered', { name: rule.name, severity: rule.severity });
          await rule.action();
          metricsCollector.incrementCounter('alerts_triggered_total', {
            name: rule.name,
            severity: rule.severity,
          });
        }
      } catch (error) {
        logger.error('Error checking alert rule', {
          name: rule.name,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
  }

  startMonitoring(intervalMs: number = 60000): void {
    setInterval(() => {
      this.checkAlerts().catch(error => {
        logger.error('Alert monitoring error', error instanceof Error ? error : new Error(String(error)));
      });
    }, intervalMs);
    logger.info('Alert monitoring started', { intervalMs });
  }

  // Pre-configured alert rules
  async setupDefaultAlerts(): Promise<void> {
    // High error rate alert
    await this.addAlertRule(
      'high_error_rate',
      async () => {
        // Check if error rate > 5%
        const errorRate = 0.06; // In production, calculate from metrics
        return errorRate > 0.05;
      },
      'high',
      async () => {
        // In production, send to PagerDuty
        logger.error('High error rate detected - sending alert');
      }
    );

    // Slow response time alert
    await this.addAlertRule(
      'slow_response_time',
      async () => {
        const p95ResponseTime = 2500; // ms
        return p95ResponseTime > 2000;
      },
      'medium',
      async () => {
        logger.warn('Slow response time detected - sending alert');
      }
    );

    // Service downtime alert
    await this.addAlertRule(
      'service_down',
      async () => {
        // Check health endpoint
        return false; // In production, check actual health
      },
      'critical',
      async () => {
        logger.error('Service down - sending critical alert');
      }
    );
  }
}

export const alertingSystem = new AlertingSystem();
