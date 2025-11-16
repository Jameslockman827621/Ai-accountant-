import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('permissions-service');

export interface Permission {
  id: string;
  permissionName: string;
  resourceType: string;
  action: string;
  description: string | null;
}

export interface Role {
  id: string;
  roleName: string;
  roleType: 'system' | 'custom';
  description: string | null;
  permissions: Permission[];
}

/**
 * Permissions Service (Chunk 3)
 * Centralizes RBAC/ABAC policies with caching
 */
export class PermissionsService {
  private permissionCache: Map<string, Permission> = new Map();
  private roleCache: Map<string, Role> = new Map();
  private userPermissionsCache: Map<string, Set<string>> = new Map();

  /**
   * Check if user has permission
   */
  async hasPermission(
    userId: UserId,
    tenantId: TenantId,
    permissionName: string,
    resourceId?: string
  ): Promise<boolean> {
    const cacheKey = `${userId}:${tenantId}:${permissionName}`;
    const cached = this.userPermissionsCache.get(cacheKey);
    if (cached?.has(permissionName)) {
      return true;
    }

    // Get user roles
    const userRoles = await this.getUserRoles(userId, tenantId);

    // Check each role for permission
    for (const role of userRoles) {
      const roleWithPerms = await this.getRole(role.id);
      if (!roleWithPerms) {
        continue;
      }

      for (const perm of roleWithPerms.permissions) {
        if (perm.permissionName === permissionName) {
          // Check ABAC conditions if present
          const rolePerm = await this.getRolePermission(role.id, perm.id);
          if (rolePerm && rolePerm.conditions) {
            if (!this.evaluateConditions(rolePerm.conditions, { userId, tenantId, resourceId })) {
              continue;
            }
          }

          // Cache and return
          if (!this.userPermissionsCache.has(cacheKey)) {
            this.userPermissionsCache.set(cacheKey, new Set());
          }
          this.userPermissionsCache.get(cacheKey)?.add(permissionName);
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get user roles
   */
  async getUserRoles(userId: UserId, tenantId: TenantId): Promise<Array<{ id: string; roleName: string }>> {
    const result = await db.query<{
      id: string;
      role_id: string;
      role_name: string;
    }>(
      `SELECT ur.id, ur.role_id, r.role_name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1
         AND (ur.tenant_id = $2 OR ur.tenant_id IS NULL)
         AND (ur.expires_at IS NULL OR ur.expires_at > NOW())`,
      [userId, tenantId]
    );

    return result.rows.map(row => ({
      id: row.role_id,
      roleName: row.role_name,
    }));
  }

  /**
   * Get role with permissions
   */
  async getRole(roleId: string): Promise<Role | null> {
    // Check cache
    if (this.roleCache.has(roleId)) {
      return this.roleCache.get(roleId)!;
    }

    const result = await db.query<{
      id: string;
      role_name: string;
      role_type: string;
      description: string | null;
    }>(
      `SELECT * FROM roles WHERE id = $1`,
      [roleId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    // Get permissions
    const permResult = await db.query<{
      permission_id: string;
      permission_name: string;
      resource_type: string;
      action: string;
      description: string | null;
    }>(
      `SELECT p.id as permission_id, p.permission_name, p.resource_type, p.action, p.description
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1`,
      [roleId]
    );

    const role: Role = {
      id: row.id,
      roleName: row.role_name,
      roleType: row.role_type as Role['roleType'],
      description: row.description,
      permissions: permResult.rows.map(p => ({
        id: p.permission_id,
        permissionName: p.permission_name,
        resourceType: p.resource_type,
        action: p.action,
        description: p.description,
      })),
    };

    this.roleCache.set(roleId, role);
    return role;
  }

  /**
   * Get role permission with conditions
   */
  private async getRolePermission(roleId: string, permissionId: string): Promise<{
    conditions: Record<string, unknown> | null;
  } | null> {
    const result = await db.query<{
      conditions: unknown;
    }>(
      `SELECT conditions FROM role_permissions
       WHERE role_id = $1 AND permission_id = $2`,
      [roleId, permissionId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      conditions: (result.rows[0].conditions as Record<string, unknown>) || null,
    };
  }

  /**
   * Evaluate ABAC conditions
   */
  private evaluateConditions(
    conditions: Record<string, unknown>,
    context: { userId: string; tenantId: string; resourceId?: string }
  ): boolean {
    // Simple condition evaluation (in production, would be more sophisticated)
    for (const [key, value] of Object.entries(conditions)) {
      if (key === 'tenant_id' && context.tenantId !== value) {
        return false;
      }
      if (key === 'user_id' && context.userId !== value) {
        return false;
      }
    }

    return true;
  }

  /**
   * Assign role to user
   */
  async assignRole(
    userId: UserId,
    roleId: string,
    tenantId: TenantId | null,
    assignedBy: UserId,
    expiresAt?: Date
  ): Promise<void> {
    await db.query(
      `INSERT INTO user_roles (
        id, user_id, role_id, tenant_id, assigned_by, expires_at, assigned_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, NOW()
      ) ON CONFLICT (user_id, role_id, tenant_id) DO UPDATE
      SET assigned_by = $4,
          expires_at = $5,
          assigned_at = NOW()`,
      [userId, roleId, tenantId, assignedBy, expiresAt || null]
    );

    // Clear cache
    this.userPermissionsCache.clear();

    logger.info('Role assigned', { userId, roleId, tenantId });
  }

  /**
   * Create permission
   */
  async createPermission(
    permissionName: string,
    resourceType: string,
    action: string,
    description?: string
  ): Promise<string> {
    const result = await db.query<{ id: string }>(
      `INSERT INTO permissions (
        id, permission_name, resource_type, action, description, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW()
      ) RETURNING id`,
      [permissionName, resourceType, action, description || null]
    );

    return result.rows[0].id;
  }

  /**
   * Add permission to role
   */
  async addPermissionToRole(
    roleId: string,
    permissionId: string,
    conditions?: Record<string, unknown>
  ): Promise<void> {
    await db.query(
      `INSERT INTO role_permissions (
        id, role_id, permission_id, conditions, created_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3::jsonb, NOW()
      ) ON CONFLICT (role_id, permission_id) DO UPDATE
      SET conditions = $3::jsonb`,
      [roleId, permissionId, JSON.stringify(conditions || {})]
    );

    // Clear cache
    this.roleCache.delete(roleId);
  }
}

export const permissionsService = new PermissionsService();
