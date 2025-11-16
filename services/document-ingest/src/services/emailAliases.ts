import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomBytes } from 'crypto';

const logger = createLogger('email-aliases-service');

export interface EmailAlias {
  id: string;
  tenantId: TenantId;
  aliasSlug: string;
  aliasEmail: string;
  secretToken: string;
  enabled: boolean;
  autoClassify: boolean;
  routingRules: Record<string, unknown>;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export class EmailAliasesService {
  /**
   * Create email alias for tenant (Chunk 1)
   */
  async createAlias(
    tenantId: TenantId,
    userId: UserId,
    expiresInDays: number = 365
  ): Promise<EmailAlias> {
    const aliasSlug = this.generateSlug();
    const secretToken = this.generateSecret();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Get email domain from environment
    const emailDomain = process.env.EMAIL_INGESTION_DOMAIN || 'ingest.example.com';
    const aliasEmail = `${tenantId.slice(0, 8)}-${aliasSlug}@${emailDomain}`;

    const result = await db.query<{
      id: string;
      tenant_id: string;
      alias_slug: string;
      alias_email: string;
      secret_token: string;
      enabled: boolean;
      auto_classify: boolean;
      routing_rules: unknown;
      expires_at: Date | null;
      last_used_at: Date | null;
      created_at: Date;
    }>(
      `INSERT INTO email_aliases (
        id, tenant_id, alias_slug, alias_email, secret_token,
        enabled, auto_classify, expires_at, created_by, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, true, true, $5, $6, NOW(), NOW()
      ) RETURNING *`,
      [tenantId, aliasSlug, aliasEmail, secretToken, expiresAt, userId]
    );

    const row = result.rows[0];
    logger.info('Email alias created', { tenantId, aliasEmail, aliasId: row.id });

    return {
      id: row.id,
      tenantId: row.tenant_id,
      aliasSlug: row.alias_slug,
      aliasEmail: row.alias_email,
      secretToken: row.secret_token,
      enabled: row.enabled,
      autoClassify: row.auto_classify,
      routingRules: (row.routing_rules as Record<string, unknown>) || {},
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
    };
  }

  /**
   * Get alias by email address
   */
  async getAliasByEmail(email: string): Promise<EmailAlias | null> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      alias_slug: string;
      alias_email: string;
      secret_token: string;
      enabled: boolean;
      auto_classify: boolean;
      routing_rules: unknown;
      expires_at: Date | null;
      last_used_at: Date | null;
      created_at: Date;
    }>(
      `SELECT * FROM email_aliases
       WHERE alias_email = $1 AND enabled = true
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [email]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      aliasSlug: row.alias_slug,
      aliasEmail: row.alias_email,
      secretToken: row.secret_token,
      enabled: row.enabled,
      autoClassify: row.auto_classify,
      routingRules: (row.routing_rules as Record<string, unknown>) || {},
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
    };
  }

  /**
   * Get all aliases for tenant
   */
  async getTenantAliases(tenantId: TenantId): Promise<EmailAlias[]> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      alias_slug: string;
      alias_email: string;
      secret_token: string;
      enabled: boolean;
      auto_classify: boolean;
      routing_rules: unknown;
      expires_at: Date | null;
      last_used_at: Date | null;
      created_at: Date;
    }>(
      `SELECT * FROM email_aliases
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId]
    );

    return result.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      aliasSlug: row.alias_slug,
      aliasEmail: row.alias_email,
      secretToken: row.secret_token,
      enabled: row.enabled,
      autoClassify: row.auto_classify,
      routingRules: (row.routing_rules as Record<string, unknown>) || {},
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
    }));
  }

  /**
   * Update alias last used timestamp
   */
  async markAliasUsed(aliasId: string): Promise<void> {
    await db.query(
      `UPDATE email_aliases
       SET last_used_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [aliasId]
    );
  }

  /**
   * Disable expired aliases (background job)
   */
  async expireUnusedAliases(daysUnused: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysUnused);

    const result = await db.query(
      `UPDATE email_aliases
       SET enabled = false, updated_at = NOW()
       WHERE enabled = true
       AND (last_used_at IS NULL OR last_used_at < $1)
       AND expires_at < NOW()`,
      [cutoffDate]
    );

    logger.info('Expired unused email aliases', { count: result.rowCount });
    return result.rowCount || 0;
  }

  /**
   * Delete alias
   */
  async deleteAlias(aliasId: string, tenantId: TenantId): Promise<void> {
    await db.query(
      `DELETE FROM email_aliases
       WHERE id = $1 AND tenant_id = $2`,
      [aliasId, tenantId]
    );

    logger.info('Email alias deleted', { aliasId, tenantId });
  }

  /**
   * Generate random slug
   */
  private generateSlug(): string {
    return randomBytes(8).toString('hex');
  }

  /**
   * Generate secret token
   */
  private generateSecret(): string {
    return randomBytes(32).toString('hex');
  }
}

export const emailAliasesService = new EmailAliasesService();

// Background job to expire unused aliases (run daily)
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    emailAliasesService.expireUnusedAliases().catch(error => {
      logger.error('Failed to expire unused aliases', error instanceof Error ? error : new Error(String(error)));
    });
  }, 24 * 60 * 60 * 1000); // 24 hours
}
