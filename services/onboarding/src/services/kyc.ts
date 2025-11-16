import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('kyc-service');

export type KYCProvider = 'persona' | 'onfido' | 'jumio' | 'internal';
export type KYCVerificationType = 'identity' | 'business' | 'address' | 'document' | 'comprehensive';
export type KYCStatus = 'pending' | 'in_progress' | 'approved' | 'rejected' | 'expired' | 'requires_review';
export type KYCVerificationLevel = 'basic' | 'standard' | 'enhanced' | 'premium';

export interface KYCVerificationRequest {
  tenantId: TenantId;
  userId: UserId;
  verificationType: KYCVerificationType;
  provider?: KYCProvider;
  documentType?: string;
  documentReferences?: string[];
  metadata?: Record<string, unknown>;
}

export interface KYCVerificationResult {
  id: string;
  status: KYCStatus;
  providerVerificationId?: string;
  providerScore?: number;
  providerReason?: string;
  requiresManualReview: boolean;
  expiresAt?: Date;
}

export class KYCService {
  async initiateVerification(request: KYCVerificationRequest): Promise<string> {
    const verificationId = randomUUID();
    const provider = request.provider || 'internal';

    // Determine verification level based on business type
    const verificationLevel = await this.determineVerificationLevel(request.tenantId);

    await db.query(
      `INSERT INTO kyc_verifications (
        id, tenant_id, user_id, verification_type, provider,
        verification_level, document_type, document_references,
        status, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
      [
        verificationId,
        request.tenantId,
        request.userId,
        request.verificationType,
        provider,
        verificationLevel,
        request.documentType || null,
        request.documentReferences ? JSON.stringify(request.documentReferences) : null,
        'pending',
        JSON.stringify(request.metadata || {}),
      ]
    );

    logger.info('KYC verification initiated', {
      verificationId,
      tenantId: request.tenantId,
      provider,
      verificationType: request.verificationType,
    });

    // In production, call external KYC provider API
    if (provider !== 'internal') {
      await this.callExternalProvider(verificationId, provider, request);
    } else {
      // For internal/mock, auto-approve basic verifications
      if (request.verificationType === 'identity' && verificationLevel === 'basic') {
        await this.updateVerificationStatus(verificationId, 'approved', {
          providerScore: 0.95,
          providerReason: 'Internal verification passed',
        });
      }
    }

    return verificationId;
  }

  async updateVerificationStatus(
    verificationId: string,
    status: KYCStatus,
    providerData?: {
      providerVerificationId?: string;
      providerScore?: number;
      providerReason?: string;
      extractedData?: Record<string, unknown>;
      requiresReview?: boolean;
    }
  ): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramCount = 1;

    updates.push(`status = $${paramCount++}`);
    params.push(status);

    if (status === 'approved') {
      updates.push(`verified_at = NOW()`);
      // Set expiry (e.g., 1 year for identity verification)
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      updates.push(`expires_at = $${paramCount++}`);
      params.push(expiresAt);
    }

    if (providerData) {
      if (providerData.providerVerificationId) {
        updates.push(`provider_verification_id = $${paramCount++}`);
        params.push(providerData.providerVerificationId);
      }
      if (providerData.providerScore !== undefined) {
        updates.push(`provider_score = $${paramCount++}`);
        params.push(providerData.providerScore);
      }
      if (providerData.providerReason) {
        updates.push(`provider_reason = $${paramCount++}`);
        params.push(providerData.providerReason);
      }
      if (providerData.extractedData) {
        updates.push(`extracted_data = $${paramCount++}::jsonb`);
        params.push(JSON.stringify(providerData.extractedData));
      }
      if (providerData.requiresReview !== undefined) {
        updates.push(`requires_manual_review = $${paramCount++}`);
        params.push(providerData.requiresReview);
      }
    }

    params.push(verificationId);

    await db.query(
      `UPDATE kyc_verifications
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount}`,
      params
    );

    logger.info('KYC verification status updated', { verificationId, status });
  }

  async getVerification(verificationId: string): Promise<KYCVerificationResult | null> {
    const result = await db.query<{
      id: string;
      status: string;
      provider_verification_id: string | null;
      provider_score: number | null;
      provider_reason: string | null;
      requires_manual_review: boolean;
      expires_at: Date | null;
    }>(
      `SELECT id, status, provider_verification_id, provider_score,
              provider_reason, requires_manual_review, expires_at
       FROM kyc_verifications
       WHERE id = $1`,
      [verificationId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      status: row.status as KYCStatus,
      providerVerificationId: row.provider_verification_id || undefined,
      providerScore: row.provider_score || undefined,
      providerReason: row.provider_reason || undefined,
      requiresManualReview: row.requires_manual_review,
      expiresAt: row.expires_at || undefined,
    };
  }

  async getTenantVerifications(tenantId: TenantId): Promise<KYCVerificationResult[]> {
    const result = await db.query<{
      id: string;
      status: string;
      verification_type: string;
      provider_verification_id: string | null;
      provider_score: number | null;
      requires_manual_review: boolean;
      expires_at: Date | null;
    }>(
      `SELECT id, status, verification_type, provider_verification_id,
              provider_score, requires_manual_review, expires_at
       FROM kyc_verifications
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId]
    );

    return result.rows.map(row => ({
      id: row.id,
      status: row.status as KYCStatus,
      providerVerificationId: row.provider_verification_id || undefined,
      providerScore: row.provider_score || undefined,
      requiresManualReview: row.requires_manual_review,
      expiresAt: row.expires_at || undefined,
    }));
  }

  async manualReview(
    verificationId: string,
    reviewerId: UserId,
    approved: boolean,
    reviewNotes?: string
  ): Promise<void> {
    const status = approved ? 'approved' : 'rejected';

    await db.query(
      `UPDATE kyc_verifications
       SET status = $1,
           reviewed_by = $2,
           reviewed_at = NOW(),
           review_notes = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [status, reviewerId, reviewNotes || null, verificationId]
    );

    if (approved) {
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      await db.query(
        `UPDATE kyc_verifications
         SET verified_at = NOW(), expires_at = $1
         WHERE id = $2`,
        [expiresAt, verificationId]
      );
    }

    logger.info('KYC verification manually reviewed', {
      verificationId,
      reviewerId,
      approved,
    });
  }

  async handleWebhook(
    provider: KYCProvider,
    webhookData: Record<string, unknown>
  ): Promise<void> {
    // Handle webhook from external KYC provider
    const providerVerificationId = webhookData.verification_id as string;
    const status = webhookData.status as string;
    const score = webhookData.score as number | undefined;
    const reason = webhookData.reason as string | undefined;

    // Find verification by provider ID
    const result = await db.query<{ id: string }>(
      `SELECT id FROM kyc_verifications
       WHERE provider = $1 AND provider_verification_id = $2`,
      [provider, providerVerificationId]
    );

    if (result.rows.length === 0) {
      logger.warn('KYC webhook received for unknown verification', {
        provider,
        providerVerificationId,
      });
      return;
    }

    const verificationId = result.rows[0].id;

    // Map provider status to our status
    let mappedStatus: KYCStatus = 'pending';
    if (status === 'approved' || status === 'verified') {
      mappedStatus = 'approved';
    } else if (status === 'rejected' || status === 'failed') {
      mappedStatus = 'rejected';
    } else if (status === 'review') {
      mappedStatus = 'requires_review';
    }

    await this.updateVerificationStatus(verificationId, mappedStatus, {
      providerScore: score,
      providerReason: reason,
      requiresReview: mappedStatus === 'requires_review',
    });

    logger.info('KYC webhook processed', {
      verificationId,
      provider,
      status: mappedStatus,
    });
  }

  private async determineVerificationLevel(tenantId: TenantId): Promise<KYCVerificationLevel> {
    // Check intent profile for business type and revenue
    const intentResult = await db.query<{
      entity_type: string;
      annual_revenue_range: string | null;
    }>(
      'SELECT entity_type, annual_revenue_range FROM intent_profiles WHERE tenant_id = $1',
      [tenantId]
    );

    if (intentResult.rows.length === 0) {
      return 'basic';
    }

    const profile = intentResult.rows[0];
    const revenueRange = profile.annual_revenue_range;

    // Enhanced verification for larger businesses
    if (revenueRange === 'large' || revenueRange === 'enterprise') {
      return 'enhanced';
    }

    // Standard for most businesses
    return 'standard';
  }

  private async callExternalProvider(
    verificationId: string,
    provider: KYCProvider,
    request: KYCVerificationRequest
  ): Promise<void> {
    // In production, this would call the actual provider API
    // For now, simulate async processing
    logger.info('Calling external KYC provider', {
      verificationId,
      provider,
      verificationType: request.verificationType,
    });

    // Simulate async processing - in production, this would be a webhook callback
    setTimeout(async () => {
      // Mock approval for demo
      await this.updateVerificationStatus(verificationId, 'approved', {
        providerVerificationId: `ext_${randomUUID()}`,
        providerScore: 0.92,
        providerReason: 'Verification passed',
      });
    }, 2000);
  }
}

export const kycService = new KYCService();
