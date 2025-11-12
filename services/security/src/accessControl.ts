import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { UserId, TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('security-service');

// Enhanced Access Control
export class AccessControl {
  async checkPermission(
    userId: UserId,
    resource: string,
    action: string
  ): Promise<boolean> {
    const result = await db.query<{ has_permission: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM user_permissions
        WHERE user_id = $1 AND resource = $2 AND action = $3 AND granted = true
      ) as has_permission`,
      [userId, resource, action]
    );

    const hasPermission = result.rows[0]?.has_permission || false;

    logger.debug('Permission check', { userId, resource, action, hasPermission });
    return hasPermission;
  }

  async grantPermission(
    userId: UserId,
    resource: string,
    action: string
  ): Promise<void> {
    await db.query(
      `INSERT INTO user_permissions (user_id, resource, action, granted)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (user_id, resource, action) DO UPDATE
       SET granted = true`,
      [userId, resource, action]
    );

    logger.info('Permission granted', { userId, resource, action });
  }

  async revokePermission(
    userId: UserId,
    resource: string,
    action: string
  ): Promise<void> {
    await db.query(
      `UPDATE user_permissions
       SET granted = false
       WHERE user_id = $1 AND resource = $2 AND action = $3`,
      [userId, resource, action]
    );

    logger.info('Permission revoked', { userId, resource, action });
  }

  async enforceTenantIsolation(
    userId: UserId,
    tenantId: TenantId,
    resourceId: string
  ): Promise<boolean> {
    // Verify user belongs to tenant
    const userResult = await db.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return false;
    }

    const userTenantId = userResult.rows[0]?.tenant_id;
    return userTenantId === tenantId;
  }
}

export const accessControl = new AccessControl();
