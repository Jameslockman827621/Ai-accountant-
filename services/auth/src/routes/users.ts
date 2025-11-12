import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { UserRole } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { NotFoundError, AuthorizationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('auth-service');

// Get all users in tenant
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await db.query(
      `SELECT id, email, name, role, is_active, last_login_at, created_at
       FROM users
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [req.user.tenantId]
    );

    res.json({ users: result.rows });
  } catch (error) {
    logger.error('Get users failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Get user by ID
router.get('/:userId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { userId } = req.params;

    const result = await db.query(
      `SELECT id, email, name, role, is_active, last_login_at, created_at
       FROM users
       WHERE id = $1 AND tenant_id = $2`,
      [userId, req.user.tenantId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User', userId);
    }

    res.json({ user: result.rows[0] });
  } catch (error: unknown) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    logger.error('Get user failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update user (only own profile or admin)
router.patch('/:userId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { userId } = req.params;
    const { name, role, isActive } = req.body;

    // Check if user can update this profile
    if (userId !== req.user.userId && req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT) {
      throw new AuthorizationError('Insufficient permissions to update this user');
    }

    // Verify user exists in same tenant
    const userCheck = await db.query(
      'SELECT id FROM users WHERE id = $1 AND tenant_id = $2',
      [userId, req.user.tenantId]
    );

    if (userCheck.rows.length === 0) {
      throw new NotFoundError('User', userId);
    }

    // Build update query
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      params.push(name);
    }

    if (role !== undefined && (req.user.role === UserRole.SUPER_ADMIN || req.user.role === UserRole.ACCOUNTANT)) {
      updates.push(`role = $${paramCount++}`);
      params.push(role);
    }

    if (isActive !== undefined && (req.user.role === UserRole.SUPER_ADMIN || req.user.role === UserRole.ACCOUNTANT)) {
      updates.push(`is_active = $${paramCount++}`);
      params.push(isActive);
    }

    if (updates.length === 0) {
      res.json({ message: 'No changes' });
      return;
    }

    params.push(userId);
    await db.query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount}`,
      params
    );

    logger.info('User updated', { userId, updatedBy: req.user.userId });

    res.json({ message: 'User updated successfully' });
  } catch (error: unknown) {
    if (error instanceof NotFoundError || error instanceof AuthorizationError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error('Update user failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to update user' });
  }
});

export { router as userRouter };
