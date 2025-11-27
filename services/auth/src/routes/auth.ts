import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { authenticator } from 'otplib';
import { OAuth2Client } from 'google-auth-library';
import { db } from '@ai-accountant/database';
import {
  generateToken,
  validateEmail,
  validatePassword,
  ValidationError,
  createLogger,
} from '@ai-accountant/shared-utils';
import { UserRole } from '@ai-accountant/shared-types';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendEmail } from '@ai-accountant/notification-service/services/email';
import {
  createEmailVerificationToken,
  consumeEmailVerificationToken,
  createPasswordResetToken,
  consumePasswordResetToken,
  createMfaChallenge,
  consumeMfaChallenge,
} from '../services/securityTokens';
import { evaluateAdaptiveRisk } from '../services/adaptiveAuth';

const router = Router();
const logger = createLogger('auth-service');

const APP_ORIGIN = process.env.APP_URL || 'http://localhost:3000';
const EMAIL_VERIFICATION_URL = process.env.EMAIL_VERIFICATION_URL || `${APP_ORIGIN}/verify-email`;
const PASSWORD_RESET_URL = process.env.PASSWORD_RESET_URL || `${APP_ORIGIN}/reset-password`;
const MFA_ISSUER = process.env.MFA_ISSUER || 'AI Accountant';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

authenticator.options = { window: 1 };

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

interface GoogleSsoBody {
  idToken: string;
  tenantName?: string;
  country?: string;
}

type UserWithTenant = {
  id: string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
  is_active: boolean;
  tenant_id: string;
  tenant_name: string;
  email_verified: boolean;
  mfa_enabled: boolean;
  mfa_secret: string | null;
  last_login_at?: Date | null;
};

async function fetchUserByEmail(email: string, tenantFilter?: string): Promise<UserWithTenant | null> {
  let query = `
    SELECT u.id,
           u.email,
           u.name,
           u.role,
           u.password_hash,
           u.is_active,
           u.tenant_id,
           t.name AS tenant_name,
           COALESCE(u.email_verified, false) AS email_verified,
           COALESCE(u.mfa_enabled, false) AS mfa_enabled,
           u.mfa_secret,
           u.last_login_at
    FROM users u
    JOIN tenants t ON u.tenant_id = t.id
    WHERE u.email = $1`;
  const params: unknown[] = [email];

  if (tenantFilter) {
    query += ' AND u.tenant_id = $2';
    params.push(tenantFilter);
  }

  const result = await db.query<UserWithTenant>(query, params);
  return result.rows[0] ?? null;
}

function sanitizeCountry(country?: string): string {
  if (!country) return 'GB';
  return country.trim().slice(0, 2).toUpperCase();
}

async function sendVerificationEmailMessage(to: string, recipientName: string, token: string): Promise<void> {
  const link = `${EMAIL_VERIFICATION_URL}?token=${encodeURIComponent(token)}`;
  const subject = 'Verify your AI Accountant email';
  const html = `
    <p>Hi ${recipientName || 'there'},</p>
    <p>Welcome to AI Accountant. Please verify your email address to activate your workspace.</p>
    <p><a href="${link}">Verify my email</a></p>
    <p>This link expires in 48 hours.</p>
    <p>If you did not sign up, you can safely ignore this message.</p>
  `;
  await sendEmail(to, subject, html);
}

async function sendPasswordResetEmailMessage(to: string, recipientName: string, token: string): Promise<void> {
  const link = `${PASSWORD_RESET_URL}?token=${encodeURIComponent(token)}`;
  const subject = 'Reset your AI Accountant password';
  const html = `
    <p>Hi ${recipientName || 'there'},</p>
    <p>We received a request to reset your password. If this was you, click the secure link below:</p>
    <p><a href="${link}">Reset password</a></p>
    <p>This link expires in 2 hours. If you did not request a reset, you can ignore this email.</p>
  `;
  await sendEmail(to, subject, html);
}

async function buildAuthResponse(user: UserWithTenant) {
  const token = generateToken({
    userId: user.id,
    tenantId: user.tenant_id,
    role: user.role as UserRole,
    email: user.email,
  });

  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  return {
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
  };
}

function ensurePassword(password: string | undefined): string {
  if (!password) {
    throw new ValidationError('Password is required');
  }
  return validatePassword(password);
}

// Register new tenant and user
router.post('/register', async (req: Request<unknown, unknown, RegisterBody>, res: Response) => {
  try {
    const { email, password, name, tenantName, country } = req.body;

    const validEmail = validateEmail(email);
    const validPassword = ensurePassword(password);

    if (!name?.trim()) {
      throw new ValidationError('Name is required');
    }
    if (!tenantName?.trim()) {
      throw new ValidationError('Tenant name is required');
    }

    const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [validEmail]);
    if (existingUser.rows.length > 0) {
      throw new ValidationError('Email already registered');
    }

    const sanitizedCountry = sanitizeCountry(country);

    const { tenant, user } = await db.transaction(async (client: any) => {
      const tenantResult = await client.query(
        `INSERT INTO tenants (name, country, subscription_tier)
         VALUES ($1, $2, 'freelancer')
         RETURNING id, name, country, subscription_tier`,
        [tenantName.trim(), sanitizedCountry]
      );
      const tenantRow = tenantResult.rows[0];
      if (!tenantRow) {
        throw new Error('Failed to create tenant');
      }

      const passwordHash = await bcrypt.hash(validPassword, 10);
      const userResult = await client.query(
        `INSERT INTO users (tenant_id, email, name, password_hash, role, email_verified)
         VALUES ($1, $2, $3, $4, $5, false)
         RETURNING id, email, name, role`,
        [tenantRow.id, validEmail, name.trim(), passwordHash, UserRole.CLIENT]
      );
      const userRow = userResult.rows[0];
      if (!userRow) {
        throw new Error('Failed to create user');
      }

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
        [tenantRow.id, JSON.stringify(defaultAccounts)]
      );

      const periodStart = new Date();
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      await client.query(
        `INSERT INTO subscriptions (tenant_id, tier, status, current_period_start, current_period_end)
         VALUES ($1, 'freelancer', 'active', $2, $3)`,
        [tenantRow.id, periodStart, periodEnd]
      );

      return { tenant: tenantRow, user: userRow };
    });

    const verificationToken = await createEmailVerificationToken(user.id);
    await sendVerificationEmailMessage(user.email, user.name, verificationToken);

    logger.info('User registered', { userId: user.id, tenantId: tenant.id });

    res.status(201).json({
      message: 'Registration successful. Please verify your email before signing in.',
      requiresEmailVerification: true,
    });
  } catch (error: unknown) {
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

    const user = await fetchUserByEmail(validEmail, tenantId);
    if (!user || !user.is_active) {
      throw new ValidationError('Invalid email or password');
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      throw new ValidationError('Invalid email or password');
    }

    if (!user.email_verified) {
      res.status(403).json({
        error: 'Email address is not verified',
        requiresEmailVerification: true,
      });
      return;
    }

    const adaptiveRisk = evaluateAdaptiveRisk(req, {
      id: user.id,
      email: user.email,
      tenantId: user.tenant_id,
      mfaEnabled: user.mfa_enabled,
      lastLoginAt: user.last_login_at,
    });

    if (adaptiveRisk.level === 'block') {
      res.status(403).json({
        error: 'Sign-in blocked due to high risk. Please contact support.',
        risk: adaptiveRisk,
      });
      return;
    }

    if (user.mfa_enabled || adaptiveRisk.level === 'high') {
      const challengeToken = await createMfaChallenge(user.id);
      res.json({
        requiresMfa: true,
        challengeToken,
        risk: adaptiveRisk,
      });
      return;
    }

    const payload = await buildAuthResponse(user);
    res.json({ ...payload, risk: adaptiveRisk });
  } catch (error: unknown) {
    logger.error('Login failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Login failed' });
  }
});

// Resend verification email
router.post('/email/resend', async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) {
      throw new ValidationError('Email is required');
    }
    const validEmail = validateEmail(email);
    const user = await fetchUserByEmail(validEmail);
    if (user && !user.email_verified) {
      const token = await createEmailVerificationToken(user.id);
      await sendVerificationEmailMessage(user.email, user.name, token);
    }
    res.json({ message: 'If an account exists, a verification email has been sent.' });
  } catch (error: unknown) {
    logger.error('Resend verification failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to resend verification email' });
  }
});

// Verify email
router.post('/email/verify', async (req: Request, res: Response) => {
  try {
    const { token } = req.body as { token?: string };
    if (!token) {
      throw new ValidationError('Verification token is required');
    }

    const userId = await consumeEmailVerificationToken(token);
    if (!userId) {
      throw new ValidationError('Invalid or expired verification link');
    }

    await db.query(
      `UPDATE users
       SET email_verified = true,
           email_verified_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    res.json({ message: 'Email verified successfully. You can now sign in.' });
  } catch (error: unknown) {
    logger.error('Email verification failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to verify email' });
  }
});

// Forgot password
router.post('/password/forgot', async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) {
      throw new ValidationError('Email is required');
    }

    const validEmail = validateEmail(email);
    const user = await fetchUserByEmail(validEmail);
    if (user && user.email_verified && user.is_active) {
      const token = await createPasswordResetToken(user.id);
      await sendPasswordResetEmailMessage(user.email, user.name, token);
    }

    res.json({ message: 'If an account exists, a password reset email has been sent.' });
  } catch (error: unknown) {
    logger.error('Password reset request failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to initiate password reset' });
  }
});

// Reset password
router.post('/password/reset', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body as { token?: string; password?: string };
    if (!token) {
      throw new ValidationError('Reset token is required');
    }

    const validPassword = ensurePassword(password);
    const userId = await consumePasswordResetToken(token);
    if (!userId) {
      throw new ValidationError('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(validPassword, 10);
    await db.query(
      `UPDATE users
       SET password_hash = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, userId]
    );

    res.json({ message: 'Password updated successfully.' });
  } catch (error: unknown) {
    logger.error('Password reset failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to reset password' });
  }
});

// MFA setup
router.post('/mfa/setup', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(req.user.email, MFA_ISSUER, secret);

    await db.query(
      `UPDATE users
       SET mfa_secret = $1,
           mfa_enabled = false,
           updated_at = NOW()
       WHERE id = $2`,
      [secret, req.user.userId]
    );

    res.json({ secret, otpauthUrl });
  } catch (error: unknown) {
    logger.error('MFA setup failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Unable to start MFA setup' });
  }
});

router.post('/mfa/enable', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { code } = req.body as { code?: string };
    if (!code) {
      throw new ValidationError('MFA code is required');
    }

    const result = await db.query<{ mfa_secret: string | null }>('SELECT mfa_secret FROM users WHERE id = $1', [
      req.user.userId,
    ]);
    const secret = result.rows[0]?.mfa_secret;
    if (!secret) {
      throw new ValidationError('Start MFA setup before enabling');
    }

    const valid = authenticator.check(code, secret);
    if (!valid) {
      throw new ValidationError('Invalid MFA code');
    }

    await db.query(
      `UPDATE users
       SET mfa_enabled = true,
           updated_at = NOW()
       WHERE id = $1`,
      [req.user.userId]
    );

    res.json({ message: 'MFA enabled successfully.' });
  } catch (error: unknown) {
    logger.error('Enable MFA failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to enable MFA' });
  }
});

router.post('/mfa/disable', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { code } = req.body as { code?: string };
    if (!code) {
      throw new ValidationError('MFA code is required');
    }

    const result = await db.query<{ mfa_secret: string | null }>('SELECT mfa_secret FROM users WHERE id = $1', [
      req.user.userId,
    ]);
    const secret = result.rows[0]?.mfa_secret;
    if (!secret) {
      throw new ValidationError('MFA is not configured');
    }

    const valid = authenticator.check(code, secret);
    if (!valid) {
      throw new ValidationError('Invalid MFA code');
    }

    await db.query(
      `UPDATE users
       SET mfa_enabled = false,
           mfa_secret = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [req.user.userId]
    );

    res.json({ message: 'MFA disabled.' });
  } catch (error: unknown) {
    logger.error('Disable MFA failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to disable MFA' });
  }
});

router.post('/mfa/verify', async (req: Request, res: Response) => {
  try {
    const { challengeToken, code } = req.body as { challengeToken?: string; code?: string };
    if (!challengeToken || !code) {
      throw new ValidationError('Challenge token and code are required');
    }

    const userId = await consumeMfaChallenge(challengeToken);
    if (!userId) {
      throw new ValidationError('Invalid or expired MFA challenge');
    }

    const result = await db.query<UserWithTenant>(
      `SELECT u.id, u.email, u.name, u.role, u.password_hash, u.is_active,
              u.tenant_id, t.name as tenant_name, u.email_verified,
              COALESCE(u.mfa_enabled, false) AS mfa_enabled,
              u.mfa_secret
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1`,
      [userId]
    );
    const user = result.rows[0];
    if (!user || !user.mfa_secret) {
      throw new ValidationError('MFA is not configured for this account');
    }

    const valid = authenticator.check(code, user.mfa_secret);
    if (!valid) {
      throw new ValidationError('Invalid MFA code');
    }

    const payload = await buildAuthResponse(user);
    res.json(payload);
  } catch (error: unknown) {
    logger.error('Verify MFA failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to verify MFA challenge' });
  }
});

// Google SSO
router.post('/sso/google', async (req: Request<unknown, unknown, GoogleSsoBody>, res: Response) => {
  try {
    if (!googleClient) {
      throw new ValidationError('Google SSO is not configured');
    }

    const { idToken, tenantName, country } = req.body;
    if (!idToken) {
      throw new ValidationError('idToken is required');
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      throw new ValidationError('Unable to verify Google identity');
    }

    const email = payload.email.toLowerCase();
    let user = await fetchUserByEmail(email);

    if (!user) {
      if (!tenantName?.trim()) {
        throw new ValidationError('Tenant name is required for first-time Google sign-in');
      }

      const sanitizedCountry = sanitizeCountry(country || payload.locale);
      const displayName = payload.name || payload.given_name || 'New User';

        const { tenant, createdUser } = await db.transaction(async (client: any) => {
          const tenantResult = await client.query(
            `INSERT INTO tenants (name, country, subscription_tier)
             VALUES ($1, $2, 'freelancer')
             RETURNING id, name`,
            [tenantName.trim(), sanitizedCountry]
          );
          const tenantRow = tenantResult.rows[0];
          if (!tenantRow) {
            throw new Error('Failed to create tenant from Google SSO');
          }

          const randomPassword = randomUUID();
          const passwordHash = await bcrypt.hash(randomPassword, 10);
          const userResult = await client.query(
            `INSERT INTO users (tenant_id, email, name, password_hash, role, email_verified, email_verified_at)
             VALUES ($1, $2, $3, $4, $5, true, NOW())
             RETURNING id, email, name, role, password_hash, is_active, tenant_id, email_verified, mfa_enabled, mfa_secret`,
            [tenantRow.id, email, displayName, passwordHash, UserRole.CLIENT]
          );
          const created = userResult.rows[0];
          if (!created) {
            throw new Error('Failed to create user from Google SSO');
          }

          await client.query(
            `INSERT INTO chart_of_accounts (tenant_id, accounts)
             VALUES ($1, '[]'::jsonb)
             ON CONFLICT (tenant_id) DO NOTHING`,
            [tenantRow.id]
          );

          const periodStart = new Date();
          const periodEnd = new Date();
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          await client.query(
            `INSERT INTO subscriptions (tenant_id, tier, status, current_period_start, current_period_end)
             VALUES ($1, 'freelancer', 'active', $2, $3)`,
            [tenantRow.id, periodStart, periodEnd]
          );

          return { tenant: tenantRow, createdUser: created };
        });

      user = {
        ...createdUser,
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        password_hash: createdUser.password_hash,
        is_active: true,
        email_verified: true,
      } as UserWithTenant;
    }

    if (!user.is_active) {
      throw new ValidationError('Account is inactive');
    }

    const adaptiveRisk = evaluateAdaptiveRisk(req, {
      id: user.id,
      email: user.email,
      tenantId: user.tenant_id,
      mfaEnabled: user.mfa_enabled,
      lastLoginAt: user.last_login_at,
    });

    if (adaptiveRisk.level === 'block') {
      res.status(403).json({
        error: 'Sign-in blocked due to high risk. Please contact support.',
        risk: adaptiveRisk,
      });
      return;
    }

    if (user.mfa_enabled || adaptiveRisk.level === 'high') {
      const challengeToken = await createMfaChallenge(user.id);
      res.json({
        requiresMfa: true,
        challengeToken,
        via: 'google',
        risk: adaptiveRisk,
      });
      return;
    }

    const payloadResponse = await buildAuthResponse(user);
    res.json({ ...payloadResponse, risk: adaptiveRisk });
  } catch (error: unknown) {
    logger.error('Google SSO failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to complete Google sign-in' });
  }
});

// Get current user
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await db.query<{
      id: string;
      email: string;
      name: string;
      role: string;
      last_login_at: Date | null;
      created_at: Date;
      email_verified: boolean;
      mfa_enabled: boolean;
      tenant_id: string;
      tenant_name: string;
      country: string;
      subscription_tier: string;
    }>(
      `SELECT u.id, u.email, u.name, u.role, u.last_login_at, u.created_at,
              COALESCE(u.email_verified, false) AS email_verified,
              COALESCE(u.mfa_enabled, false) AS mfa_enabled,
              t.id as tenant_id, t.name as tenant_name, t.country, t.subscription_tier
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1`,
      [req.user.userId]
    );

    const user = result.rows[0];
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at,
        emailVerified: user.email_verified,
        mfaEnabled: user.mfa_enabled,
      },
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name,
        country: user.country,
        subscriptionTier: user.subscription_tier,
      },
    });
  } catch (error: unknown) {
    logger.error('Get user failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export { router as authRouter };
