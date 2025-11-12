import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { db } from '@ai-accountant/database';
import { generateToken, validateEmail, validatePassword, ValidationError } from '@ai-accountant/shared-utils';
import { UserRole } from '@ai-accountant/shared-types';
import { createLogger } from '@ai-accountant/shared-utils';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const logger = createLogger('auth-service');

interface RegisterBody {
  email: string;
  password: string;
  name: string;
  tenantName: string;
  country: string;
}

interface LoginBody {
  email: string;
  password: string;
  tenantId?: string;
}

// Register new tenant and user
router.post('/register', async (req: Request<unknown, unknown, RegisterBody>, res: Response) => {
  try {
    const { email, password, name, tenantName, country } = req.body;

    // Validate input
    const validEmail = validateEmail(email);
    const validPassword = validatePassword(password);

    if (!name || name.trim().length === 0) {
      throw new ValidationError('Name is required');
    }
    if (!tenantName || tenantName.trim().length === 0) {
      throw new ValidationError('Tenant name is required');
    }
    if (!country || country.length !== 2) {
      throw new ValidationError('Country code (2 letters) is required');
    }

    // Check if email already exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [validEmail]
    );

    if (existingUser.rows.length > 0) {
      throw new ValidationError('Email already registered');
    }

    // Create tenant and user in transaction
    const result = await db.transaction(async (client) => {
      // Create tenant
      const tenantResult = await client.query(
        `INSERT INTO tenants (name, country, subscription_tier)
         VALUES ($1, $2, 'freelancer')
         RETURNING id, name, country, subscription_tier, created_at`,
        [tenantName, country.toUpperCase()]
      );
      const tenant = tenantResult.rows[0];

      if (!tenant) {
        throw new Error('Failed to create tenant');
      }

      // Hash password
      const passwordHash = await bcrypt.hash(validPassword, 10);

      // Create user
      const userResult = await client.query(
        `INSERT INTO users (tenant_id, email, name, password_hash, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, name, role, created_at`,
        [tenant.id, validEmail, name, passwordHash, UserRole.CLIENT]
      );
      const user = userResult.rows[0];

      if (!user) {
        throw new Error('Failed to create user');
      }

      // Create default chart of accounts
      const defaultAccounts = [
        { code: '1000', name: 'Cash', type: 'asset', parentCode: null, isActive: true },
        { code: '2000', name: 'Accounts Receivable', type: 'asset', parentCode: null, isActive: true },
        { code: '3000', name: 'Inventory', type: 'asset', parentCode: null, isActive: true },
        { code: '4000', name: 'Accounts Payable', type: 'liability', parentCode: null, isActive: true },
        { code: '5000', name: 'Sales Revenue', type: 'revenue', parentCode: null, isActive: true },
        { code: '6000', name: 'Cost of Goods Sold', type: 'expense', parentCode: null, isActive: true },
        { code: '7000', name: 'Operating Expenses', type: 'expense', parentCode: null, isActive: true },
        { code: '8000', name: 'VAT Payable', type: 'liability', parentCode: null, isActive: true },
        { code: '9000', name: 'VAT Recoverable', type: 'asset', parentCode: null, isActive: true },
      ];

      await client.query(
        `INSERT INTO chart_of_accounts (tenant_id, accounts)
         VALUES ($1, $2)`,
        [tenant.id, JSON.stringify(defaultAccounts)]
      );

      // Create subscription
      const periodStart = new Date();
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      await client.query(
        `INSERT INTO subscriptions (tenant_id, tier, status, current_period_start, current_period_end)
         VALUES ($1, 'freelancer', 'active', $2, $3)`,
        [tenant.id, periodStart, periodEnd]
      );

      return { tenant, user };
    });

    // Generate token
    const token = generateToken({
      userId: result.user.id,
      tenantId: result.tenant.id,
      role: result.user.role as UserRole,
      email: result.user.email,
    });

    // Update last login
    await db.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [result.user.id]
    );

    logger.info('User registered', { userId: result.user.id, tenantId: result.tenant.id });

    res.status(201).json({
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
      },
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        country: result.tenant.country,
        subscriptionTier: result.tenant.subscription_tier,
      },
    });
  } catch (error) {
    logger.error('Registration failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req: Request<unknown, unknown, LoginBody>, res: Response) => {
  try {
    const { email, password, tenantId } = req.body;

    const validEmail = validateEmail(email);
    if (!password) {
      throw new ValidationError('Password is required');
    }

    // Find user
    let query = 'SELECT u.*, t.id as tenant_id, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = $1';
    const params: unknown[] = [validEmail];

    if (tenantId) {
      query += ' AND u.tenant_id = $2';
      params.push(tenantId);
    }

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      throw new ValidationError('Invalid email or password');
    }

    const user = result.rows[0];

    if (!user.is_active) {
      throw new ValidationError('Account is inactive');
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      throw new ValidationError('Invalid email or password');
    }

    // Generate token
    const token = generateToken({
      userId: user.id,
      tenantId: user.tenant_id,
      role: user.role as UserRole,
      email: user.email,
    });

    // Update last login
    await db.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    logger.info('User logged in', { userId: user.id, tenantId: user.tenant_id });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name,
      },
    });
  } catch (error) {
    logger.error('Login failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await db.query(
      `SELECT u.id, u.email, u.name, u.role, u.last_login_at, u.created_at,
              t.id as tenant_id, t.name as tenant_name, t.country, t.subscription_tier
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = result.rows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at,
      },
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name,
        country: user.country,
        subscriptionTier: user.subscription_tier,
      },
    });
  } catch (error) {
    logger.error('Get user failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export { router as authRouter };
