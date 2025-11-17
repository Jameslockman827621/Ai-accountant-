import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { createHmac, timingSafeEqual } from 'crypto';
import { randomBytes, createHash } from 'crypto';

const logger = createLogger('webhook-security');

export interface WebhookVerificationResult {
  isValid: boolean;
  tenantId?: TenantId;
  apiKeyId?: string;
  error?: string;
}

export class WebhookSecurityService {
  /**
   * Verify webhook HMAC signature
   */
  verifyHMAC(
    provider: string,
    signature: string,
    payload: string | Buffer,
    secret: string
  ): boolean {
    try {
      let expectedSignature: string;

      switch (provider) {
        case 'shopify':
          expectedSignature = createHmac('sha256', secret).update(payload).digest('base64');
          return timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
          );
        case 'stripe':
          expectedSignature = createHmac('sha256', secret).update(payload).digest('hex');
          return timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(`sha256=${expectedSignature}`)
          );
        case 'plaid':
          expectedSignature = createHmac('sha256', secret).update(payload).digest('hex');
          return timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
          );
        default:
          logger.warn('Unknown webhook provider', { provider });
          return false;
      }
    } catch (error) {
      logger.error('HMAC verification failed', {
        provider,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return false;
    }
  }

  /**
   * Verify webhook using API key
   */
  async verifyApiKey(
    apiKey: string,
    tenantId?: TenantId
  ): Promise<WebhookVerificationResult> {
    try {
      const keyHash = createHash('sha256').update(apiKey).digest('hex');

      let query = `
        SELECT tk.id, tk.tenant_id, tk.scopes, tk.is_active, tk.expires_at
        FROM tenant_api_keys tk
        WHERE tk.key_hash = $1 AND tk.is_active = true
      `;
      const params: unknown[] = [keyHash];

      if (tenantId) {
        query += ` AND tk.tenant_id = $2`;
        params.push(tenantId);
      }

      const result = await db.query<{
        id: string;
        tenant_id: string;
        scopes: string[];
        is_active: boolean;
        expires_at: Date | null;
      }>(query, params);

      if (result.rows.length === 0) {
        return {
          isValid: false,
          error: 'Invalid API key',
        };
      }

      const apiKeyRecord = result.rows[0];

      // Check expiration
      if (apiKeyRecord.expires_at && apiKeyRecord.expires_at < new Date()) {
        return {
          isValid: false,
          error: 'API key expired',
        };
      }

      // Update last used timestamp
      await db.query(
        `UPDATE tenant_api_keys SET last_used_at = NOW() WHERE id = $1`,
        [apiKeyRecord.id]
      );

      return {
        isValid: true,
        tenantId: apiKeyRecord.tenant_id as TenantId,
        apiKeyId: apiKeyRecord.id,
      };
    } catch (error) {
      logger.error('API key verification failed', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return {
        isValid: false,
        error: 'Verification failed',
      };
    }
  }

  /**
   * Create API key for tenant
   */
  async createApiKey(
    tenantId: TenantId,
    keyName: string,
    scopes: string[],
    createdBy: string,
    options?: {
      rateLimitPerMinute?: number;
      rateLimitPerHour?: number;
      expiresAt?: Date;
    }
  ): Promise<{ apiKey: string; apiKeyId: string }> {
    // Generate API key
    const apiKey = `ak_${randomBytes(32).toString('hex')}`;
    const keyHash = createHash('sha256').update(apiKey).digest('hex');

    const apiKeyId = randomBytes(16).toString('hex');

    await db.query(
      `INSERT INTO tenant_api_keys (
        id, tenant_id, key_name, key_hash, scopes,
        rate_limit_per_minute, rate_limit_per_hour, expires_at, created_by,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
      [
        apiKeyId,
        tenantId,
        keyName,
        keyHash,
        scopes,
        options?.rateLimitPerMinute || 100,
        options?.rateLimitPerHour || 1000,
        options?.expiresAt || null,
        createdBy,
      ]
    );

    logger.info('API key created', { tenantId, keyName, apiKeyId });

    return { apiKey, apiKeyId };
  }

  /**
   * Check rate limit for API key
   */
  async checkRateLimit(
    apiKeyId: string,
    endpoint: string,
    ipAddress?: string
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const apiKeyResult = await db.query<{
      rate_limit_per_minute: number;
      rate_limit_per_hour: number;
    }>(
      `SELECT rate_limit_per_minute, rate_limit_per_hour
       FROM tenant_api_keys
       WHERE id = $1 AND is_active = true`,
      [apiKeyId]
    );

    if (apiKeyResult.rows.length === 0) {
      return { allowed: false, remaining: 0, resetAt: new Date() };
    }

    const limits = apiKeyResult.rows[0];
    const now = new Date();
    const minuteAgo = new Date(now.getTime() - 60 * 1000);
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Check per-minute limit
    const minuteCount = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM rate_limit_logs
       WHERE api_key_id = $1 AND endpoint = $2
         AND window_start >= $3`,
      [apiKeyId, endpoint, minuteAgo]
    );

    const minuteRequests = parseInt(minuteCount.rows[0]?.count || '0', 10);
    if (minuteRequests >= limits.rate_limit_per_minute) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(now.getTime() + 60 * 1000),
      };
    }

    // Check per-hour limit
    const hourCount = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM rate_limit_logs
       WHERE api_key_id = $1 AND endpoint = $2
         AND window_start >= $3`,
      [apiKeyId, endpoint, hourAgo]
    );

    const hourRequests = parseInt(hourCount.rows[0]?.count || '0', 10);
    if (hourRequests >= limits.rate_limit_per_hour) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(now.getTime() + 60 * 60 * 1000),
      };
    }

    // Log request
    await db.query(
      `INSERT INTO rate_limit_logs (
        tenant_id, api_key_id, endpoint, ip_address, window_start, window_end, created_at
      ) VALUES (
        (SELECT tenant_id FROM tenant_api_keys WHERE id = $1),
        $1, $2, $3, $4, $5, NOW()
      )`,
      [
        apiKeyId,
        endpoint,
        ipAddress || null,
        minuteAgo,
        now,
      ]
    );

    return {
      allowed: true,
      remaining: Math.min(
        limits.rate_limit_per_minute - minuteRequests,
        limits.rate_limit_per_hour - hourRequests
      ),
      resetAt: new Date(now.getTime() + 60 * 1000),
    };
  }

  /**
   * Revoke API key
   */
  async revokeApiKey(apiKeyId: string): Promise<void> {
    await db.query(
      `UPDATE tenant_api_keys SET is_active = false, updated_at = NOW()
       WHERE id = $1`,
      [apiKeyId]
    );

    logger.info('API key revoked', { apiKeyId });
  }
}

export const webhookSecurityService = new WebhookSecurityService();
