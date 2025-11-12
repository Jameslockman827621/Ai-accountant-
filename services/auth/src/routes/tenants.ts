import { Router, Response } from 'express';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { UserRole } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('auth-service');

// Get current tenant
router.get('/current', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await db.query(
      `SELECT t.*, s.tier as subscription_tier, s.status as subscription_status,
              s.current_period_start, s.current_period_end
       FROM tenants t
       LEFT JOIN subscriptions s ON t.id = s.tenant_id
       WHERE t.id = $1`,
      [req.user.tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const tenant = result.rows[0] as {
      id: string;
      name: string;
      country: string;
      tax_id: string | null;
      vat_number: string | null;
      subscription_tier: string;
      subscription_status: string | null;
      current_period_start: Date | null;
      current_period_end: Date | null;
      created_at: Date;
      updated_at: Date;
    };
    res.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        country: tenant.country,
        taxId: tenant.tax_id,
        vatNumber: tenant.vat_number,
        subscriptionTier: tenant.subscription_tier,
        subscriptionStatus: tenant.subscription_status,
        currentPeriodStart: tenant.current_period_start,
        currentPeriodEnd: tenant.current_period_end,
        createdAt: tenant.created_at,
        updatedAt: tenant.updated_at,
      },
    });
  } catch (error) {
    logger.error('Get tenant failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get tenant' });
  }
});

// Update tenant (admin only)
router.patch('/current', authenticate, requireRole(UserRole.SUPER_ADMIN, UserRole.ACCOUNTANT), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, taxId, vatNumber } = req.body;

    const updates: string[] = [];
    const params: unknown[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      params.push(name);
    }

    if (taxId !== undefined) {
      updates.push(`tax_id = $${paramCount++}`);
      params.push(taxId);
    }

    if (vatNumber !== undefined) {
      updates.push(`vat_number = $${paramCount++}`);
      params.push(vatNumber);
    }

    if (updates.length === 0) {
      res.json({ message: 'No changes' });
      return;
    }

    params.push(req.user.tenantId);
    await db.query(
      `UPDATE tenants SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount}`,
      params
    );

    logger.info('Tenant updated', { tenantId: req.user.tenantId, updatedBy: req.user.userId });

    res.json({ message: 'Tenant updated successfully' });
  } catch (error) {
    logger.error('Update tenant failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to update tenant' });
  }
});

export { router as tenantRouter };
