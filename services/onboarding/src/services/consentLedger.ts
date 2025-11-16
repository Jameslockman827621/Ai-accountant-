import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('consent-ledger-service');

export type ConsentType = 'banking' | 'tax_authority' | 'data_sharing' | 'marketing' | 'gdpr' | 'ccpa';
export type ConsentStatus = 'granted' | 'revoked' | 'expired' | 'pending';
export type ConsentMethod = 'web_form' | 'api' | 'oauth' | 'email_link';

export interface ConsentRecord {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  consentType: ConsentType;
  consentScope?: string;
  provider?: string;
  status: ConsentStatus;
  grantedAt?: Date;
  expiresAt?: Date;
  revokedAt?: Date;
}

export interface CreateConsentInput {
  tenantId: TenantId;
  userId: UserId;
  consentType: ConsentType;
  consentScope?: string;
  provider?: string;
  consentText: string;
  ipAddress?: string;
  userAgent?: string;
  consentMethod: ConsentMethod;
  expiresAt?: Date;
  gdprBasis?: string;
  ccpaOptOut?: boolean;
  dataUsageStatement?: string;
  metadata?: Record<string, unknown>;
}

export class ConsentLedgerService {
  async recordConsent(input: CreateConsentInput): Promise<string> {
    const consentId = randomUUID();

    await db.query(
      `INSERT INTO consent_ledger (
        id, tenant_id, user_id, consent_type, consent_scope, provider,
        consent_status, consent_text, ip_address, user_agent, consent_method,
        granted_at, expires_at, gdpr_basis, ccpa_opt_out, data_usage_statement,
        metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, NOW(), NOW())`,
      [
        consentId,
        input.tenantId,
        input.userId,
        input.consentType,
        input.consentScope || null,
        input.provider || null,
        'granted',
        input.consentText,
        input.ipAddress || null,
        input.userAgent || null,
        input.consentMethod,
        new Date(),
        input.expiresAt || null,
        input.gdprBasis || null,
        input.ccpaOptOut || false,
        input.dataUsageStatement || null,
        JSON.stringify(input.metadata || {}),
      ]
    );

    logger.info('Consent recorded', {
      consentId,
      tenantId: input.tenantId,
      consentType: input.consentType,
    });

    return consentId;
  }

  async revokeConsent(consentId: string, userId: UserId, reason?: string): Promise<void> {
    await db.query(
      `UPDATE consent_ledger
       SET consent_status = $1,
           revoked_at = NOW(),
           revoked_reason = $2,
           updated_at = NOW()
       WHERE id = $3 AND user_id = $4`,
      ['revoked', reason || null, consentId, userId]
    );

    logger.info('Consent revoked', { consentId, userId });
  }

  async getTenantConsents(tenantId: TenantId): Promise<ConsentRecord[]> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      user_id: string;
      consent_type: string;
      consent_scope: string | null;
      provider: string | null;
      consent_status: string;
      granted_at: Date | null;
      expires_at: Date | null;
      revoked_at: Date | null;
    }>(
      `SELECT id, tenant_id, user_id, consent_type, consent_scope, provider,
              consent_status, granted_at, expires_at, revoked_at
       FROM consent_ledger
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId]
    );

    return result.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      consentType: row.consent_type as ConsentType,
      consentScope: row.consent_scope || undefined,
      provider: row.provider || undefined,
      status: row.consent_status as ConsentStatus,
      grantedAt: row.granted_at || undefined,
      expiresAt: row.expires_at || undefined,
      revokedAt: row.revoked_at || undefined,
    }));
  }

  async checkConsent(
    tenantId: TenantId,
    consentType: ConsentType,
    consentScope?: string
  ): Promise<boolean> {
    const query = consentScope
      ? `SELECT id FROM consent_ledger
         WHERE tenant_id = $1 AND consent_type = $2 AND consent_scope = $3
           AND consent_status = 'granted'
           AND (expires_at IS NULL OR expires_at > NOW())
           AND revoked_at IS NULL
         LIMIT 1`
      : `SELECT id FROM consent_ledger
         WHERE tenant_id = $1 AND consent_type = $2
           AND consent_status = 'granted'
           AND (expires_at IS NULL OR expires_at > NOW())
           AND revoked_at IS NULL
         LIMIT 1`;

    const params = consentScope ? [tenantId, consentType, consentScope] : [tenantId, consentType];

    const result = await db.query(query, params);
    return result.rows.length > 0;
  }

  async expireConsents(): Promise<number> {
    const result = await db.query(
      `UPDATE consent_ledger
       SET consent_status = 'expired', updated_at = NOW()
       WHERE consent_status = 'granted'
         AND expires_at IS NOT NULL
         AND expires_at <= NOW()
         AND revoked_at IS NULL
       RETURNING id`
    );

    const expiredCount = result.rows.length;
    if (expiredCount > 0) {
      logger.info('Consents expired', { count: expiredCount });
    }

    return expiredCount;
  }
}

export const consentLedgerService = new ConsentLedgerService();
