import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

const logger = createLogger('security-service');

/**
 * Enable MFA for user
 */
export async function enableMFA(
  tenantId: TenantId,
  userId: UserId
): Promise<{ secret: string; qrCodeUrl: string }> {
  const secret = speakeasy.generateSecret({
    name: `AI Accountant (${userId})`,
    issuer: 'AI Accountant SaaS',
  });

  // Store secret (encrypted in production)
  await db.query(
    `UPDATE users
     SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{mfa_secret}', $1::jsonb),
         mfa_enabled = true,
         updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
    [JSON.stringify(secret.base32), userId, tenantId]
  );

  // Generate QR code
  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url || '');

  logger.info('MFA enabled', { userId, tenantId });
  return { secret: secret.base32 || '', qrCodeUrl };
}

/**
 * Verify MFA token
 */
export async function verifyMFAToken(
  tenantId: TenantId,
  userId: UserId,
  token: string
): Promise<boolean> {
  const user = await db.query<{
    metadata: unknown;
    mfa_enabled: boolean;
  }>(
    'SELECT metadata, mfa_enabled FROM users WHERE id = $1 AND tenant_id = $2',
    [userId, tenantId]
  );

  if (user.rows.length === 0 || !user.rows[0].mfa_enabled) {
    return false;
  }

  const metadata = user.rows[0].metadata as Record<string, unknown> | null;
  const secret = metadata?.mfa_secret as string | undefined;

  if (!secret) {
    return false;
  }

  const verified = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 2, // Allow 2 time steps (60 seconds) tolerance
  });

  if (verified) {
    logger.info('MFA token verified', { userId, tenantId });
  } else {
    logger.warn('MFA token verification failed', { userId, tenantId });
  }

  return verified;
}

/**
 * Disable MFA for user
 */
export async function disableMFA(
  tenantId: TenantId,
  userId: UserId
): Promise<void> {
  await db.query(
    `UPDATE users
     SET mfa_enabled = false,
         metadata = metadata - 'mfa_secret',
         updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [userId, tenantId]
  );

  logger.info('MFA disabled', { userId, tenantId });
}
