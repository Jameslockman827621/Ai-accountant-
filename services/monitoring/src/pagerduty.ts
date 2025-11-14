import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('monitoring-service');

// PagerDuty Integration
export class PagerDutyIntegration {
  private apiKey: string;
  private serviceKey: string;

  constructor() {
    this.apiKey = process.env.PAGERDUTY_API_KEY || '';
    this.serviceKey = process.env.PAGERDUTY_SERVICE_KEY || '';

    if (!this.apiKey || !this.serviceKey) {
      logger.warn('PagerDuty credentials not fully configured', {
        hasApiKey: Boolean(this.apiKey),
        hasServiceKey: Boolean(this.serviceKey),
      });
    }
  }

  async triggerIncident(
    summary: string,
    severity: 'critical' | 'error' | 'warning' | 'info',
    details: Record<string, unknown>
  ): Promise<string> {
    // In production, use PagerDuty SDK
    // const incident = await pagerDutyClient.incidents.create({
    //   incident: {
    //     type: 'incident',
    //     title: summary,
    //     service: { id: this.serviceKey, type: 'service_reference' },
    //     urgency: severity === 'critical' ? 'high' : 'low',
    //     body: { details },
    //   },
    // });

    logger.error('PagerDuty incident triggered', undefined, { summary, severity, details });
    return 'incident-id';
  }

  async resolveIncident(incidentId: string): Promise<void> {
    // In production, resolve incident
    logger.info('PagerDuty incident resolved', { incidentId });
  }
}

export const pagerDuty = new PagerDutyIntegration();
