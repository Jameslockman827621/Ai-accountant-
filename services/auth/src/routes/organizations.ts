import { Router, Response } from 'express';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { UserRole, OrganizationType, OrganizationRole } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { ValidationError, NotFoundError, AuthorizationError } from '@ai-accountant/shared-utils';
import { randomUUID } from 'crypto';

const router = Router();
const logger = createLogger('auth-service');

// Get all organizations (for firms, shows clients; for clients, shows their firm)
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get user's tenant organization
    const tenantResult = await db.query(
      'SELECT organization_id FROM tenants WHERE id = $1',
      [req.user.tenantId]
    );

    const organizationId = tenantResult.rows[0]?.organization_id;

    let query: string;
    let params: unknown[];

    if (organizationId) {
      // If user belongs to an organization, show that org and its children (for firms)
      query = `
        SELECT o.*, COUNT(DISTINCT t.id) as client_count
        FROM organizations o
        LEFT JOIN tenants t ON t.organization_id = o.id
        WHERE o.id = $1 OR o.parent_organization_id = $1
        GROUP BY o.id
        ORDER BY o.created_at DESC
      `;
      params = [organizationId];
    } else {
      // Admin can see all, others see none
      if (req.user.role !== UserRole.SUPER_ADMIN) {
        res.json({ organizations: [] });
        return;
      }
      query = `
        SELECT o.*, COUNT(DISTINCT t.id) as client_count
        FROM organizations o
        LEFT JOIN tenants t ON t.organization_id = o.id
        GROUP BY o.id
        ORDER BY o.created_at DESC
      `;
      params = [];
    }

    const result = await db.query(query, params);
    res.json({ organizations: result.rows });
  } catch (error) {
    logger.error('Get organizations failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get organizations' });
  }
});

// Get organization by ID
router.get('/:organizationId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { organizationId } = req.params;

    // Check access
    const accessCheck = await db.query(
      `SELECT o.id FROM organizations o
       LEFT JOIN tenants t ON t.organization_id = o.id
       WHERE o.id = $1 AND (t.id = $2 OR o.parent_organization_id IN (
         SELECT organization_id FROM tenants WHERE id = $2
       ))`,
      [organizationId, req.user.tenantId]
    );

    if (accessCheck.rows.length === 0 && req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Access denied to this organization');
    }

    const result = await db.query(
      `SELECT o.*, 
              COUNT(DISTINCT t.id) as client_count,
              COUNT(DISTINCT u.id) as user_count
       FROM organizations o
       LEFT JOIN tenants t ON t.organization_id = o.id
       LEFT JOIN users u ON u.tenant_id = t.id
       WHERE o.id = $1
       GROUP BY o.id`,
      [organizationId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Organization', organizationId);
    }

    res.json({ organization: result.rows[0] });
  } catch (error: unknown) {
    if (error instanceof NotFoundError || error instanceof AuthorizationError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error('Get organization failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get organization' });
  }
});

// Create organization (firm or client)
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, type, parentOrganizationId, country, taxId, vatNumber, registrationNumber, address, contactEmail, contactPhone, settings } = req.body;

    if (!name || !type || !country) {
      throw new ValidationError('Name, type, and country are required');
    }

    if (!Object.values(OrganizationType).includes(type)) {
      throw new ValidationError('Invalid organization type');
    }

    // Check parent organization access if provided
    if (parentOrganizationId) {
      const parentCheck = await db.query(
        `SELECT o.id FROM organizations o
         LEFT JOIN tenants t ON t.organization_id = o.id
         WHERE o.id = $1 AND (t.id = $2 OR $3 = $4)`,
        [parentOrganizationId, req.user.tenantId, req.user.role, UserRole.SUPER_ADMIN]
      );

      if (parentCheck.rows.length === 0) {
        throw new AuthorizationError('Access denied to parent organization');
      }
    }

    const organizationId = randomUUID();

    await db.query(
      `INSERT INTO organizations (
        id, name, type, parent_organization_id, country, tax_id, vat_number,
        registration_number, address, contact_email, contact_phone, settings, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        organizationId,
        name,
        type,
        parentOrganizationId || null,
        country,
        taxId || null,
        vatNumber || null,
        registrationNumber || null,
        address ? JSON.stringify(address) : null,
        contactEmail || null,
        contactPhone || null,
        settings ? JSON.stringify(settings) : '{}',
        req.user.userId,
      ]
    );

    logger.info('Organization created', { organizationId, createdBy: req.user.userId });

    res.status(201).json({ organization: { id: organizationId } });
  } catch (error: unknown) {
    if (error instanceof ValidationError || error instanceof AuthorizationError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error('Create organization failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

// Update organization
router.patch('/:organizationId', authenticate, requireRole(UserRole.SUPER_ADMIN, UserRole.ACCOUNTANT, UserRole.OWNER), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { organizationId } = req.params;
    const { name, country, taxId, vatNumber, registrationNumber, address, contactEmail, contactPhone, settings } = req.body;

    // Check access
    const accessCheck = await db.query(
      `SELECT o.id FROM organizations o
       LEFT JOIN tenants t ON t.organization_id = o.id
       WHERE o.id = $1 AND (t.id = $2 OR $3 = $4)`,
      [organizationId, req.user.tenantId, req.user.role, UserRole.SUPER_ADMIN]
    );

    if (accessCheck.rows.length === 0) {
      throw new AuthorizationError('Access denied to this organization');
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      params.push(name);
    }
    if (country !== undefined) {
      updates.push(`country = $${paramCount++}`);
      params.push(country);
    }
    if (taxId !== undefined) {
      updates.push(`tax_id = $${paramCount++}`);
      params.push(taxId);
    }
    if (vatNumber !== undefined) {
      updates.push(`vat_number = $${paramCount++}`);
      params.push(vatNumber);
    }
    if (registrationNumber !== undefined) {
      updates.push(`registration_number = $${paramCount++}`);
      params.push(registrationNumber);
    }
    if (address !== undefined) {
      updates.push(`address = $${paramCount++}`);
      params.push(JSON.stringify(address));
    }
    if (contactEmail !== undefined) {
      updates.push(`contact_email = $${paramCount++}`);
      params.push(contactEmail);
    }
    if (contactPhone !== undefined) {
      updates.push(`contact_phone = $${paramCount++}`);
      params.push(contactPhone);
    }
    if (settings !== undefined) {
      updates.push(`settings = $${paramCount++}`);
      params.push(JSON.stringify(settings));
    }

    if (updates.length === 0) {
      res.json({ message: 'No changes' });
      return;
    }

    params.push(organizationId);
    await db.query(
      `UPDATE organizations SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount}`,
      params
    );

    logger.info('Organization updated', { organizationId, updatedBy: req.user.userId });

    res.json({ message: 'Organization updated successfully' });
  } catch (error: unknown) {
    if (error instanceof AuthorizationError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error('Update organization failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

// Create organization invitation
router.post('/:organizationId/invitations', authenticate, requireRole(UserRole.SUPER_ADMIN, UserRole.ACCOUNTANT, UserRole.OWNER), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { organizationId } = req.params;
    const { email, role } = req.body;

    if (!email || !role) {
      throw new ValidationError('Email and role are required');
    }

    if (!Object.values(OrganizationRole).includes(role)) {
      throw new ValidationError('Invalid role');
    }

    // Check access
    const accessCheck = await db.query(
      `SELECT o.id FROM organizations o
       LEFT JOIN tenants t ON t.organization_id = o.id
       WHERE o.id = $1 AND (t.id = $2 OR $3 = $4)`,
      [organizationId, req.user.tenantId, req.user.role, UserRole.SUPER_ADMIN]
    );

    if (accessCheck.rows.length === 0) {
      throw new AuthorizationError('Access denied to this organization');
    }

    const invitationId = randomUUID();
    const token = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    await db.query(
      `INSERT INTO organization_invitations (
        id, organization_id, email, role, invited_by, token, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [invitationId, organizationId, email, role, req.user.userId, token, expiresAt]
    );

    logger.info('Organization invitation created', { invitationId, organizationId, email, role });

    // In production, send email with invitation link
    res.status(201).json({
      invitation: {
        id: invitationId,
        email,
        role,
        expiresAt,
        invitationLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/invitations/${token}`,
      },
    });
  } catch (error: unknown) {
    if (error instanceof ValidationError || error instanceof AuthorizationError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error('Create invitation failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to create invitation' });
  }
});

// Get organization invitations
router.get('/:organizationId/invitations', authenticate, requireRole(UserRole.SUPER_ADMIN, UserRole.ACCOUNTANT, UserRole.OWNER), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { organizationId } = req.params;

    // Check access
    const accessCheck = await db.query(
      `SELECT o.id FROM organizations o
       LEFT JOIN tenants t ON t.organization_id = o.id
       WHERE o.id = $1 AND (t.id = $2 OR $3 = $4)`,
      [organizationId, req.user.tenantId, req.user.role, UserRole.SUPER_ADMIN]
    );

    if (accessCheck.rows.length === 0) {
      throw new AuthorizationError('Access denied to this organization');
    }

    const result = await db.query(
      `SELECT oi.*, u.name as invited_by_name
       FROM organization_invitations oi
       LEFT JOIN users u ON u.id = oi.invited_by
       WHERE oi.organization_id = $1
       ORDER BY oi.created_at DESC`,
      [organizationId]
    );

    res.json({ invitations: result.rows });
  } catch (error: unknown) {
    if (error instanceof AuthorizationError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error('Get invitations failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get invitations' });
  }
});

// Accept invitation
router.post('/invitations/:token/accept', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { token } = req.params;

    const invitationResult = await db.query(
      `SELECT * FROM organization_invitations
       WHERE token = $1 AND expires_at > NOW() AND accepted_at IS NULL`,
      [token]
    );

    if (invitationResult.rows.length === 0) {
      throw new NotFoundError('Invitation', token);
    }

    const invitation = invitationResult.rows[0];

    // Check if user email matches
    const userResult = await db.query(
      'SELECT id, email FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (userResult.rows.length === 0 || userResult.rows[0].email !== invitation.email) {
      throw new AuthorizationError('Invitation email does not match your account');
    }

    // Update invitation
    await db.query(
      `UPDATE organization_invitations
       SET accepted_at = NOW(), accepted_by = $1
       WHERE id = $2`,
      [req.user.userId, invitation.id]
    );

    // Link user's tenant to organization
    await db.query(
      `UPDATE tenants SET organization_id = $1 WHERE id = $2`,
      [invitation.organization_id, req.user.tenantId]
    );

    logger.info('Invitation accepted', { invitationId: invitation.id, userId: req.user.userId });

    res.json({ message: 'Invitation accepted successfully' });
  } catch (error: unknown) {
    if (error instanceof NotFoundError || error instanceof AuthorizationError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error('Accept invitation failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

export { router as organizationRouter };
