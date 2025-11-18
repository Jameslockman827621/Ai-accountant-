import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { createPersonaService, PersonaKYCService } from './kyc/persona';
import { createOnfidoService, OnfidoKYCService } from './kyc/onfido';

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

export interface KYCSession {
  sessionId: string;
  verificationId: string;
  providerHandoffUrl?: string;
  status: KYCStatus;
}

export class KYCService {
  private personaService?: PersonaKYCService;
  private onfidoService?: OnfidoKYCService;

  constructor() {
    // Initialize providers if configured
    if (process.env.PERSONA_API_KEY) {
      this.personaService = createPersonaService({
        apiKey: process.env.PERSONA_API_KEY,
        environment: (process.env.PERSONA_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
        webhookSecret: process.env.PERSONA_WEBHOOK_SECRET,
      });
    }

    if (process.env.ONFIDO_API_TOKEN) {
      this.onfidoService = createOnfidoService({
        apiToken: process.env.ONFIDO_API_TOKEN,
        environment: (process.env.ONFIDO_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
        webhookToken: process.env.ONFIDO_WEBHOOK_TOKEN,
      });
    }
  }

  /**
   * Create a KYC verification session (Chunk 2)
   */
  async createSession(request: KYCVerificationRequest): Promise<KYCSession> {
    const verificationId = randomUUID();
    const sessionId = randomUUID();
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

    // Log audit event
    await this.logAuditEvent({
      tenantId: request.tenantId,
      userId: request.userId,
      verificationId,
      eventType: 'verification_started',
      eventSource: 'user',
      previousStatus: null,
      newStatus: 'pending',
      provider,
    });

    let providerHandoffUrl: string | undefined;

    // Call external provider if configured
    if (provider === 'persona' && this.personaService) {
      try {
        const inquiry = await this.personaService.createInquiry(
          request.tenantId,
          request.userId,
          verificationId
        );
        await this.updateVerificationStatus(verificationId, 'in_progress', {
          providerVerificationId: inquiry.id,
        });
        // Persona returns a handoff URL in the inquiry response
        providerHandoffUrl = `https://verify.withpersona.com/verify/${inquiry.id}`;
      } catch (error) {
        logger.error('Failed to create Persona inquiry', error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    } else if (provider === 'onfido' && this.onfidoService) {
      try {
        // For Onfido, we need to create an applicant first
        const applicant = await this.onfidoService.createApplicant(
          request.tenantId,
          request.userId,
          (request.metadata?.firstName as string) || 'User',
          (request.metadata?.lastName as string) || 'Name',
          (request.metadata?.email as string) || undefined
        );
        const check = await this.onfidoService.createCheck(applicant.id);
        await this.updateVerificationStatus(verificationId, 'in_progress', {
          providerVerificationId: check.id,
        });
        // Onfido returns a handoff URL
        providerHandoffUrl = `https://onfido.com/check/${check.id}`;
      } catch (error) {
        logger.error('Failed to create Onfido check', error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    } else if (provider === 'internal') {
      // For internal/mock, auto-approve basic verifications
      if (request.verificationType === 'identity' && verificationLevel === 'basic') {
        await this.updateVerificationStatus(verificationId, 'approved', {
          providerScore: 0.95,
          providerReason: 'Internal verification passed',
        });
      }
    }

    logger.info('KYC session created', {
      sessionId,
      verificationId,
      tenantId: request.tenantId,
      provider,
      hasHandoffUrl: !!providerHandoffUrl,
    });

    return {
      sessionId,
      verificationId,
      providerHandoffUrl,
      status: 'pending',
    };
  }

  async initiateVerification(request: KYCVerificationRequest): Promise<string> {
    const session = await this.createSession(request);
    return session.verificationId;
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
    // Get current status
    const current = await this.getVerification(verificationId);
    if (!current) {
      throw new Error('Verification not found');
    }

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

    // Log audit event
    await this.logAuditEvent({
      tenantId: '', // Will be fetched from verification
      userId: reviewerId,
      verificationId,
      eventType: 'review_completed',
      eventSource: 'admin',
      previousStatus: current.status,
      newStatus: status,
      reviewedBy: reviewerId,
      reviewNotes,
      reviewDecision: approved ? 'approved' : 'rejected',
    });

    logger.info('KYC verification manually reviewed', {
      verificationId,
      reviewerId,
      approved,
    });
  }

  /**
   * Get pending reviews for compliance officers (Chunk 2)
   */
  async getPendingReviews(limit = 50, offset = 0): Promise<Array<{
    id: string;
    tenantId: string;
    userId: string;
    verificationType: string;
    provider: string;
    status: string;
    requiresManualReview: boolean;
    providerScore: number | null;
    providerReason: string | null;
    createdAt: Date;
  }>> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      user_id: string;
      verification_type: string;
      provider: string;
      status: string;
      requires_manual_review: boolean;
      provider_score: number | null;
      provider_reason: string | null;
      created_at: Date;
    }>(
      `SELECT id, tenant_id, user_id, verification_type, provider, status,
              requires_manual_review, provider_score, provider_reason, created_at
       FROM kyc_verifications
       WHERE requires_manual_review = true AND status IN ('pending', 'requires_review')
       ORDER BY created_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      verificationType: row.verification_type,
      provider: row.provider,
      status: row.status,
      requiresManualReview: row.requires_manual_review,
      providerScore: row.provider_score,
      providerReason: row.provider_reason,
      createdAt: row.created_at,
    }));
  }

  /**
   * Log audit event (Chunk 2)
   */
  private async logAuditEvent(event: {
    tenantId: string;
    userId: UserId;
    verificationId: string;
    eventType: string;
    eventSource: string;
    previousStatus: string | null;
    newStatus: string;
    provider?: string;
    providerEventId?: string;
    reviewedBy?: UserId;
    reviewNotes?: string;
    reviewDecision?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      // Get tenant ID from verification if not provided
      let tenantId = event.tenantId;
      if (!tenantId) {
        const result = await db.query<{ tenant_id: string }>(
          'SELECT tenant_id FROM kyc_verifications WHERE id = $1',
          [event.verificationId]
        );
        if (result.rows.length > 0) {
          tenantId = result.rows[0].tenant_id;
        }
      }

      await db.query(
        `INSERT INTO kyc_audit_events (
          id, tenant_id, user_id, verification_id, event_type, event_source,
          previous_status, new_status, provider, provider_event_id,
          reviewed_by, review_notes, review_decision,
          ip_address, user_agent, created_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
        )`,
        [
          tenantId,
          event.userId,
          event.verificationId,
          event.eventType,
          event.eventSource,
          event.previousStatus,
          event.newStatus,
          event.provider || null,
          event.providerEventId || null,
          event.reviewedBy || null,
          event.reviewNotes || null,
          event.reviewDecision || null,
          event.ipAddress || null,
          event.userAgent || null,
        ]
      );
    } catch (error) {
      logger.error('Failed to log KYC audit event', error instanceof Error ? error : new Error(String(error)));
      // Don't throw - audit logging failures shouldn't break the flow
    }
  }

  async handleWebhook(
    provider: KYCProvider,
    webhookData: Record<string, unknown>,
    signature?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    // Verify webhook signature if provider service is available
    if (provider === 'persona' && this.personaService) {
      try {
        await this.personaService.handleWebhook(webhookData as any, signature || '');
      } catch (error) {
        logger.error('Persona webhook signature verification failed', error instanceof Error ? error : new Error(String(error)));
        throw new Error('Invalid webhook signature');
      }
    } else if (provider === 'onfido' && this.onfidoService) {
      try {
        await this.onfidoService.handleWebhook(webhookData as any, signature || '');
      } catch (error) {
        logger.error('Onfido webhook signature verification failed', error instanceof Error ? error : new Error(String(error)));
        throw new Error('Invalid webhook signature');
      }
    }

    // Extract provider-specific data
    let providerVerificationId: string;
    let status: string;
    let score: number | undefined;
    let reason: string | undefined;
    let providerEventId: string | undefined;

    if (provider === 'persona') {
      const data = webhookData.data as any;
      providerVerificationId = data.id;
      status = data.attributes?.status;
      providerEventId = data.id;
    } else if (provider === 'onfido') {
      const payload = webhookData.payload as any;
      providerVerificationId = payload.object?.id;
      status = payload.object?.status;
      score = payload.object?.score;
      reason = payload.object?.reason;
      providerEventId = payload.object?.id;
    } else {
      providerVerificationId = webhookData.verification_id as string;
      status = webhookData.status as string;
      score = webhookData.score as number | undefined;
      reason = webhookData.reason as string | undefined;
    }

    // Find verification by provider ID
    const result = await db.query<{ id: string; tenant_id: string; user_id: string; status: string }>(
      `SELECT id, tenant_id, user_id, status FROM kyc_verifications
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

    const verification = result.rows[0];
    const verificationId = verification.id;
    const previousStatus = verification.status;

    // Map provider status to our status
    let mappedStatus: KYCStatus = 'pending';
    if (status === 'approved' || status === 'verified' || status === 'completed') {
      mappedStatus = 'approved';
    } else if (status === 'rejected' || status === 'failed') {
      mappedStatus = 'rejected';
    } else if (status === 'review' || status === 'requires_review') {
      mappedStatus = 'requires_review';
    } else if (status === 'in_progress' || status === 'processing') {
      mappedStatus = 'in_progress';
    }

    await this.updateVerificationStatus(verificationId, mappedStatus, {
      providerScore: score,
      providerReason: reason,
      requiresReview: mappedStatus === 'requires_review',
    });

    // Log audit event
    await this.logAuditEvent({
      tenantId: verification.tenant_id,
      userId: verification.user_id,
      verificationId,
      eventType: 'webhook_received',
      eventSource: 'provider_webhook',
      previousStatus,
      newStatus: mappedStatus,
      provider,
      providerEventId,
      ipAddress,
      userAgent,
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

}

export const kycService = new KYCService();
