/**
 * Enhanced MFA Enforcement
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import crypto from 'crypto';
import { authenticator } from 'otplib';

const logger = createLogger('mfa-enforcement');

export interface MFAConfig {
  enforceForAll: boolean;
  enforceForAdmins: boolean;
  enforceForAccountants: boolean;
  gracePeriodDays: number;
  backupCodesCount: number;
}

export interface MFASetup {
  userId: string;
  secret: string;
  qrCode: string;
  backupCodes: string[];
}

export class MFAEnforcer {
  private config: MFAConfig;

  constructor(config: Partial<MFAConfig> = {}) {
    this.config = {
      enforceForAll: false,
      enforceForAdmins: true,
      enforceForAccountants: true,
      gracePeriodDays: 30,
      backupCodesCount: 10,
      ...config,
    };
  }

  async checkMFARequirement(userId: string): Promise<boolean> {
    const user = await db.query<{
      role: string;
      mfa_enabled: boolean;
      mfa_required: boolean;
      created_at: Date;
    }>(
      `SELECT role, mfa_enabled, mfa_required, created_at FROM users WHERE id = $1`,
      [userId]
    );

    if (user.rows.length === 0) {
      return false;
    }

    const userData = user.rows[0];

    // Check if already required
    if (userData.mfa_required) {
      return true;
    }

    // Check role-based requirements
    if (this.config.enforceForAdmins && userData.role === 'admin') {
      return true;
    }

    if (this.config.enforceForAccountants && userData.role === 'accountant') {
      return true;
    }

    // Check if grace period expired
    if (this.config.enforceForAll) {
      const daysSinceCreation = Math.floor(
        (Date.now() - new Date(userData.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceCreation > this.config.gracePeriodDays) {
        return true;
      }
    }

    return false;
  }

  async enforceMFA(userId: string): Promise<void> {
    const requiresMFA = await this.checkMFARequirement(userId);
    if (!requiresMFA) {
      return;
    }

    const user = await db.query<{ mfa_enabled: boolean }>(
      `SELECT mfa_enabled FROM users WHERE id = $1`,
      [userId]
    );

    if (user.rows.length === 0) {
      throw new Error('User not found');
    }

    if (!user.rows[0].mfa_enabled) {
      // Mark as required
      await db.query(
        `UPDATE users SET mfa_required = true WHERE id = $1`,
        [userId]
      );

      // Send notification
      logger.info('MFA enforcement triggered', { userId });
    }
  }

  async setupMFA(userId: string): Promise<MFASetup> {
    const secret = authenticator.generateSecret();
    const serviceName = process.env.SERVICE_NAME || 'AI Accountant';
    const user = await db.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`,
      [userId]
    );

    if (user.rows.length === 0) {
      throw new Error('User not found');
    }

    const email = user.rows[0].email;
    const otpauth = authenticator.keyuri(email, serviceName, secret);

    // Generate backup codes
    const backupCodes = this.generateBackupCodes(this.config.backupCodesCount);

    // Store secret (encrypted)
    await db.query(
      `UPDATE users 
       SET mfa_secret = $1, mfa_backup_codes = $2, mfa_enabled = true, mfa_required = false
       WHERE id = $3`,
      [this.encryptSecret(secret), JSON.stringify(backupCodes), userId]
    );

    return {
      userId,
      secret,
      qrCode: otpauth,
      backupCodes,
    };
  }

  async verifyMFA(userId: string, token: string): Promise<boolean> {
    const user = await db.query<{
      mfa_secret: string;
      mfa_backup_codes: string;
    }>(
      `SELECT mfa_secret, mfa_backup_codes FROM users WHERE id = $1 AND mfa_enabled = true`,
      [userId]
    );

    if (user.rows.length === 0) {
      return false;
    }

    const secret = this.decryptSecret(user.rows[0].mfa_secret);
    const backupCodes = JSON.parse(user.rows[0].mfa_backup_codes || '[]') as string[];

    // Check TOTP token
    const isValid = authenticator.verify({ token, secret });

    if (isValid) {
      return true;
    }

    // Check backup codes
    if (backupCodes.includes(token)) {
      // Remove used backup code
      const updatedCodes = backupCodes.filter(code => code !== token);
      await db.query(
        `UPDATE users SET mfa_backup_codes = $1 WHERE id = $2`,
        [JSON.stringify(updatedCodes), userId]
      );
      return true;
    }

    return false;
  }

  async disableMFA(userId: string, password: string): Promise<void> {
    // Verify password first
    const user = await db.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [userId]
    );

    if (user.rows.length === 0) {
      throw new Error('User not found');
    }

    // In production, verify password hash
    // For now, just check if MFA is required
    const requiresMFA = await this.checkMFARequirement(userId);
    if (requiresMFA) {
      throw new Error('Cannot disable MFA - it is required for your account');
    }

    await db.query(
      `UPDATE users 
       SET mfa_enabled = false, mfa_secret = NULL, mfa_backup_codes = NULL
       WHERE id = $1`,
      [userId]
    );
  }

  private generateBackupCodes(count: number): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    return codes;
  }

  private encryptSecret(secret: string): string {
    // In production, use proper encryption
    const key = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    const cipher = crypto.createCipher('aes-256-cbc', key);
    let encrypted = cipher.update(secret, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  private decryptSecret(encrypted: string): string {
    const key = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    const decipher = crypto.createDecipher('aes-256-cbc', key);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

export const mfaEnforcer = new MFAEnforcer({
  enforceForAdmins: true,
  enforceForAccountants: true,
  enforceForAll: false,
  gracePeriodDays: 30,
  backupCodesCount: 10,
});
