/**
 * Role-Based Access Control (RBAC) Service
 * Fine-grained access control with role and permission management
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';

const logger = createLogger('rbac');

export type Role = 'super_admin' | 'accountant' | 'client' | 'viewer' | 'support_staff';

export type Permission =
  | 'read:documents'
  | 'write:documents'
  | 'read:ledger'
  | 'write:ledger'
  | 'read:filings'
  | 'write:filings'
  | 'submit:filings'
  | 'read:reports'
  | 'write:reports'
  | 'read:assistant'
  | 'use:assistant'
  | 'approve:actions'
  | 'read:audit'
  | 'write:config'
  | 'manage:users'
  | 'manage:rulepacks'
  | 'export:data';

export interface RolePermissions {
  role: Role;
  permissions: Permission[];
}

// Role permission mappings
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    'read:documents',
    'write:documents',
    'read:ledger',
    'write:ledger',
    'read:filings',
    'write:filings',
    'submit:filings',
    'read:reports',
    'write:reports',
    'read:assistant',
    'use:assistant',
    'approve:actions',
    'read:audit',
    'write:config',
    'manage:users',
    'manage:rulepacks',
    'export:data',
  ],
  accountant: [
    'read:documents',
    'write:documents',
    'read:ledger',
    'write:ledger',
    'read:filings',
    'write:filings',
    'submit:filings',
    'read:reports',
    'write:reports',
    'read:assistant',
    'use:assistant',
    'approve:actions',
    'read:audit',
  ],
  client: [
    'read:documents',
    'write:documents',
    'read:ledger',
    'read:filings',
    'read:reports',
    'read:assistant',
    'use:assistant',
  ],
  viewer: ['read:documents', 'read:ledger', 'read:filings', 'read:reports', 'read:assistant'],
  support_staff: [
    'read:documents',
    'read:ledger',
    'read:filings',
    'read:reports',
    'read:assistant',
    'read:audit',
  ],
};

class RBACService {
  /**
   * Check if user has permission
   */
  async hasPermission(userId: string, permission: Permission): Promise<boolean> {
    try {
      const result = await db.query<{ role: Role }>(
        `SELECT role FROM users WHERE id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return false;
      }

      const role = result.rows[0].role;
      const permissions = ROLE_PERMISSIONS[role] || [];

      return permissions.includes(permission);
    } catch (error) {
      logger.error('Error checking permission', error);
      return false;
    }
  }

  /**
   * Check if user has any of the specified permissions
   */
  async hasAnyPermission(userId: string, permissions: Permission[]): Promise<boolean> {
    for (const permission of permissions) {
      if (await this.hasPermission(userId, permission)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if user has all of the specified permissions
   */
  async hasAllPermissions(userId: string, permissions: Permission[]): Promise<boolean> {
    for (const permission of permissions) {
      if (!(await this.hasPermission(userId, permission))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get user's role
   */
  async getUserRole(userId: string): Promise<Role | null> {
    try {
      const result = await db.query<{ role: Role }>(
        `SELECT role FROM users WHERE id = $1`,
        [userId]
      );

      return result.rows[0]?.role || null;
    } catch (error) {
      logger.error('Error getting user role', error);
      return null;
    }
  }

  /**
   * Get permissions for a role
   */
  getRolePermissions(role: Role): Permission[] {
    return ROLE_PERMISSIONS[role] || [];
  }

  /**
   * Check if action requires approval based on role
   */
  requiresApproval(role: Role, action: string): boolean {
    // Support staff and viewers require approval for write actions
    if (role === 'support_staff' || role === 'client' || role === 'viewer') {
      const writeActions = ['write:documents', 'write:ledger', 'write:filings', 'submit:filings'];
      return writeActions.some((a) => action.includes(a));
    }

    // Accountants require approval for irreversible actions
    if (role === 'accountant') {
      const irreversibleActions = ['submit:filings', 'manage:rulepacks', 'write:config'];
      return irreversibleActions.some((a) => action.includes(a));
    }

    return false;
  }
}

export const rbacService = new RBACService();

/**
 * Express middleware for permission checking
 */
export function requirePermission(permission: Permission) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const hasAccess = await rbacService.hasPermission(userId, permission);

    if (!hasAccess) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      return;
    }

    next();
  };
}
