import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import crypto from 'crypto';
import { authenticator } from 'otplib';

const logger = createLogger('security-service');

// Multi-Factor Authentication
export class MFA {
  async generateSecret(userId: string): Promise<string> {
    const secret = authenticator.generateSecret();
    
    await db.query(
      `INSERT INTO user_mfa (user_id, secret, enabled, created_at)
       VALUES ($1, $2, false, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET secret = $2, updated_at = NOW()`,
      [userId, secret]
    );

    logger.info('MFA secret generated', { userId });
    return secret;
  }

  async verifyToken(userId: string, token: string): Promise<boolean> {
    const result = await db.query<{ secret: string }>(
      'SELECT secret FROM user_mfa WHERE user_id = $1 AND enabled = true',
      [userId]
    );

    if (result.rows.length === 0) {
      return false;
    }

    const secret = result.rows[0]?.secret || '';
    const isValid = authenticator.verify({ token, secret });

    if (isValid) {
      logger.info('MFA token verified', { userId });
    } else {
      logger.warn('MFA token verification failed', { userId });
    }

    return isValid;
  }

  async enableMFA(userId: string, token: string): Promise<boolean> {
    const isValid = await this.verifyToken(userId, token);
    
    if (isValid) {
      await db.query(
        'UPDATE user_mfa SET enabled = true, updated_at = NOW() WHERE user_id = $1',
        [userId]
      );
      logger.info('MFA enabled', { userId });
    }

    return isValid;
  }

  generateQRCode(userId: string, secret: string, issuer: string = 'AI Accountant'): string {
    const otpAuthUrl = authenticator.keyuri(userId, issuer, secret);
    // In production, generate QR code image
    return otpAuthUrl;
  }
}

export const mfa = new MFA();
