import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('workflow-service');

interface TenantContact {
  id: string;
  name: string;
  email: string;
}

const reconciliationServiceUrl =
  process.env.RECONCILIATION_SERVICE_URL || 'http://reconciliation-service:3008';
const notificationServiceUrl =
  process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3010';
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN;

export class ReconciliationReportScheduler {
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) {
      return;
    }

    // Run every 6 hours
    this.timer = setInterval(() => {
      void this.run();
    }, 6 * 60 * 60 * 1000);

    // Kick off immediately at startup
    void this.run();
    logger.info('Reconciliation report scheduler started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async run(): Promise<void> {
    try {
      const tenants = await this.fetchActiveTenants();
      for (const tenant of tenants) {
        await this.generateAndSendReport(tenant);
      }
    } catch (error) {
      logger.error('Failed to run reconciliation scheduler', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async fetchActiveTenants(): Promise<TenantContact[]> {
    const result = await db.query<{
      id: string;
      name: string;
      email: string;
    }>(
      `SELECT t.id, t.name, u.email
       FROM tenants t
       JOIN users u ON u.tenant_id = t.id
       WHERE u.role = 'client' AND u.is_active = true`
    );

    return result.rows.map((row) => ({ id: row.id, name: row.name, email: row.email }));
  }

  private async generateAndSendReport(tenant: TenantContact): Promise<void> {
    try {
      const reportResponse = await fetch(
        `${reconciliationServiceUrl}/api/reconciliation/reports/reconciliation?tenantId=${tenant.id}`,
        {
          headers: this.buildHeaders(tenant.id),
        }
      );

      if (!reportResponse.ok) {
        logger.warn('Failed to fetch reconciliation report', { tenantId: tenant.id, status: reportResponse.status });
        return;
      }

      const payload = (await reportResponse.json()) as { report: unknown };

      const emailResponse = await fetch(`${notificationServiceUrl}/api/notifications/reconciliation-summary`, {
        method: 'POST',
        headers: {
          ...this.buildHeaders(tenant.id),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantId: tenant.id,
          tenantName: tenant.name,
          recipients: [tenant.email],
          report: payload.report,
        }),
      });

      if (!emailResponse.ok) {
        logger.warn('Failed to send reconciliation summary email', {
          tenantId: tenant.id,
          status: emailResponse.status,
        });
      } else {
        logger.info('Reconciliation summary email queued', { tenantId: tenant.id });
      }
    } catch (error) {
      logger.error('Reconciliation report dispatch failed', error instanceof Error ? error : new Error(String(error)), {
        tenantId: tenant.id,
      });
    }
  }

  private buildHeaders(tenantId: string): Record<string, string> {
    const headers: Record<string, string> = {};
    if (internalServiceToken) {
      headers['x-service-token'] = internalServiceToken;
    }
    headers['x-tenant-id'] = tenantId;
    return headers;
  }
}

export const reconciliationReportScheduler = new ReconciliationReportScheduler();
