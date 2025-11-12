import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('compliance-service');

// SOC 2 Control Implementation
export class SOC2Controls {
  // CC1: Control Environment
  async logControlActivity(
    userId: UserId,
    tenantId: TenantId,
    activity: string,
    details: Record<string, unknown>
  ): Promise<void> {
    await db.query(
      `INSERT INTO control_activities (
        user_id, tenant_id, activity, details, timestamp
      ) VALUES ($1, $2, $3, $4::jsonb, NOW())`,
      [userId, tenantId, activity, JSON.stringify(details)]
    );

    logger.info('Control activity logged', { userId, tenantId, activity });
  }

  // CC2: Communication and Information
  async documentControl(controlId: string, description: string): Promise<void> {
    await db.query(
      `INSERT INTO control_documentation (
        control_id, description, documented_at, updated_at
      ) VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (control_id) DO UPDATE
      SET description = $2, updated_at = NOW()`,
      [controlId, description]
    );
  }

  // CC3: Risk Assessment
  async assessRisk(
    riskId: string,
    description: string,
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): Promise<void> {
    await db.query(
      `INSERT INTO risk_assessments (
        risk_id, description, severity, assessed_at, updated_at
      ) VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (risk_id) DO UPDATE
      SET description = $2, severity = $3, updated_at = NOW()`,
      [riskId, description, severity]
    );
  }

  // CC4: Monitoring Activities
  async createMonitoringActivity(
    activity: string,
    status: 'success' | 'failure' | 'warning'
  ): Promise<void> {
    await db.query(
      `INSERT INTO monitoring_activities (
        activity, status, timestamp
      ) VALUES ($1, $2, NOW())`,
      [activity, status]
    );
  }

  // CC5: Control Activities
  async enforceAccessControl(
    userId: UserId,
    resource: string,
    action: string
  ): Promise<boolean> {
    // Check user permissions
    const result = await db.query<{ has_access: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM user_permissions
        WHERE user_id = $1 AND resource = $2 AND action = $3
      ) as has_access`,
      [userId, resource, action]
    );

    const hasAccess = result.rows[0]?.has_access || false;

    await this.logControlActivity(
      userId,
      '' as TenantId, // Would get from user context
      'access_control_check',
      { resource, action, granted: hasAccess }
    );

    return hasAccess;
  }
}

export const soc2Controls = new SOC2Controls();
