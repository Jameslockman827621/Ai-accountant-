/**
 * PagerDuty and Opsgenie Integration for Alerting
 */

import { createLogger } from '@ai-accountant/shared-utils';
import axios from 'axios';

const logger = createLogger('pagerduty-opsgenie');

export interface AlertConfig {
  provider: 'pagerduty' | 'opsgenie';
  apiKey: string;
  enabled: boolean;
}

export interface Alert {
  severity: 'critical' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  source?: string;
  customDetails?: Record<string, unknown>;
}

export class PagerDutyClient {
  private integrationKey: string;
  private enabled: boolean;

  constructor(integrationKey: string, enabled: boolean = true) {
    this.integrationKey = integrationKey;
    this.enabled = enabled;
  }

  async triggerAlert(alert: Alert): Promise<void> {
    if (!this.enabled) {
      logger.debug('PagerDuty disabled, alert not sent', alert);
      return;
    }

    try {
      const payload = {
        routing_key: this.integrationKey,
        event_action: this.getEventAction(alert.severity),
        dedup_key: this.generateDedupKey(alert),
        payload: {
          summary: alert.title,
          source: alert.source || 'ai-accountant',
          severity: this.mapSeverity(alert.severity),
          custom_details: alert.customDetails || {},
        },
      };

      await axios.post('https://events.pagerduty.com/v2/enqueue', payload, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      logger.info('PagerDuty alert sent', { title: alert.title, severity: alert.severity });
    } catch (error) {
      logger.error('Failed to send PagerDuty alert', error);
      throw error;
    }
  }

  async resolveAlert(dedupKey: string): Promise<void> {
    if (!this.enabled) return;

    try {
      const payload = {
        routing_key: this.integrationKey,
        event_action: 'resolve',
        dedup_key: dedupKey,
      };

      await axios.post('https://events.pagerduty.com/v2/enqueue', payload, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      logger.info('PagerDuty alert resolved', { dedupKey });
    } catch (error) {
      logger.error('Failed to resolve PagerDuty alert', error);
    }
  }

  private getEventAction(severity: string): string {
    if (severity === 'critical' || severity === 'error') {
      return 'trigger';
    }
    return 'acknowledge';
  }

  private mapSeverity(severity: string): string {
    const mapping: Record<string, string> = {
      critical: 'critical',
      error: 'error',
      warning: 'warning',
      info: 'info',
    };
    return mapping[severity] || 'info';
  }

  private generateDedupKey(alert: Alert): string {
    // Generate a deduplication key based on alert content
    return `${alert.source || 'default'}-${alert.title}`.replace(/\s+/g, '-').toLowerCase();
  }
}

export class OpsgenieClient {
  private apiKey: string;
  private enabled: boolean;
  private baseUrl = 'https://api.opsgenie.com/v2';

  constructor(apiKey: string, enabled: boolean = true) {
    this.apiKey = apiKey;
    this.enabled = enabled;
  }

  async triggerAlert(alert: Alert): Promise<string> {
    if (!this.enabled) {
      logger.debug('Opsgenie disabled, alert not sent', alert);
      return '';
    }

    try {
      const payload = {
        message: alert.title,
        description: alert.message,
        priority: this.mapPriority(alert.severity),
        source: alert.source || 'ai-accountant',
        details: alert.customDetails || {},
        tags: [alert.severity, alert.source || 'default'],
      };

      const response = await axios.post(`${this.baseUrl}/alerts`, payload, {
        headers: {
          Authorization: `GenieKey ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const alertId = response.data.data?.alertId || '';
      logger.info('Opsgenie alert sent', { alertId, title: alert.title });
      return alertId;
    } catch (error) {
      logger.error('Failed to send Opsgenie alert', error);
      throw error;
    }
  }

  async resolveAlert(alertId: string): Promise<void> {
    if (!this.enabled) return;

    try {
      await axios.post(
        `${this.baseUrl}/alerts/${alertId}/close`,
        { source: 'ai-accountant' },
        {
          headers: {
            Authorization: `GenieKey ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info('Opsgenie alert resolved', { alertId });
    } catch (error) {
      logger.error('Failed to resolve Opsgenie alert', error);
    }
  }

  private mapPriority(severity: string): string {
    const mapping: Record<string, string> = {
      critical: 'P1',
      error: 'P2',
      warning: 'P3',
      info: 'P4',
    };
    return mapping[severity] || 'P4';
  }
}

export class AlertManager {
  private pagerduty?: PagerDutyClient;
  private opsgenie?: OpsgenieClient;

  constructor(config?: AlertConfig) {
    if (config?.provider === 'pagerduty' && config.apiKey) {
      this.pagerduty = new PagerDutyClient(config.apiKey, config.enabled);
    } else if (config?.provider === 'opsgenie' && config.apiKey) {
      this.opsgenie = new OpsgenieClient(config.apiKey, config.enabled);
    }
  }

  async sendAlert(alert: Alert): Promise<void> {
    if (this.pagerduty) {
      await this.pagerduty.triggerAlert(alert);
    }
    if (this.opsgenie) {
      await this.opsgenie.triggerAlert(alert);
    }
  }
}

export const createAlertManager = (config?: AlertConfig): AlertManager => {
  return new AlertManager(config);
};
