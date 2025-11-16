import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('compliance-service');

export interface ComplianceEvidence {
  id: string;
  complianceFramework: 'soc2' | 'iso27001' | 'gdpr' | 'hipaa' | 'other';
  controlId: string;
  controlName: string;
  evidenceType: 'policy' | 'procedure' | 'log' | 'test_result' | 'audit_report' | 'other';
  evidenceUrl?: string;
  evidenceData?: Record<string, unknown>;
  status: 'draft' | 'reviewed' | 'approved' | 'expired';
  reviewedBy?: UserId;
  reviewedAt?: Date;
  approvedBy?: UserId;
  approvedAt?: Date;
  effectiveFrom?: Date;
  effectiveTo?: Date;
  lastVerifiedAt?: Date;
  nextReviewDue?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class ComplianceEvidenceService {
  async createEvidence(
    complianceFramework: ComplianceEvidence['complianceFramework'],
    controlId: string,
    controlName: string,
    evidenceType: ComplianceEvidence['evidenceType'],
    options: {
      evidenceUrl?: string;
      evidenceData?: Record<string, unknown>;
      effectiveFrom?: Date;
      effectiveTo?: Date;
      nextReviewDue?: Date;
    } = {}
  ): Promise<ComplianceEvidence> {
    const id = randomUUID();
    const effectiveFrom = options.effectiveFrom || new Date();

    await db.query(
      `INSERT INTO compliance_evidence (
        id, compliance_framework, control_id, control_name, evidence_type,
        evidence_url, evidence_data, status, effective_from, effective_to,
        next_review_due, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, NOW(), NOW())`,
      [
        id,
        complianceFramework,
        controlId,
        controlName,
        evidenceType,
        options.evidenceUrl || null,
        options.evidenceData ? JSON.stringify(options.evidenceData) : null,
        'draft',
        effectiveFrom,
        options.effectiveTo || null,
        options.nextReviewDue || null,
      ]
    );

    logger.info('Compliance evidence created', { id, complianceFramework, controlId });
    return this.getEvidence(id);
  }

  async getEvidence(id: string): Promise<ComplianceEvidence> {
    const result = await db.query<{
      id: string;
      compliance_framework: string;
      control_id: string;
      control_name: string;
      evidence_type: string;
      evidence_url: string | null;
      evidence_data: unknown;
      status: string;
      reviewed_by: string | null;
      reviewed_at: Date | null;
      approved_by: string | null;
      approved_at: Date | null;
      effective_from: Date | null;
      effective_to: Date | null;
      last_verified_at: Date | null;
      next_review_due: Date | null;
      created_at: Date;
      updated_at: Date;
    }>('SELECT * FROM compliance_evidence WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new Error(`Compliance evidence not found: ${id}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      complianceFramework: row.compliance_framework as ComplianceEvidence['complianceFramework'],
      controlId: row.control_id,
      controlName: row.control_name,
      evidenceType: row.evidence_type as ComplianceEvidence['evidenceType'],
      evidenceUrl: row.evidence_url || undefined,
      evidenceData: row.evidence_data as Record<string, unknown> | undefined,
      status: row.status as ComplianceEvidence['status'],
      reviewedBy: row.reviewed_by as UserId | undefined,
      reviewedAt: row.reviewed_at || undefined,
      approvedBy: row.approved_by as UserId | undefined,
      approvedAt: row.approved_at || undefined,
      effectiveFrom: row.effective_from || undefined,
      effectiveTo: row.effective_to || undefined,
      lastVerifiedAt: row.last_verified_at || undefined,
      nextReviewDue: row.next_review_due || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async updateEvidenceStatus(
    id: string,
    status: ComplianceEvidence['status'],
    options: {
      reviewedBy?: UserId;
      approvedBy?: UserId;
      lastVerifiedAt?: Date;
    } = {}
  ): Promise<ComplianceEvidence> {
    const updates: string[] = ['status = $1', 'updated_at = NOW()'];
    const params: unknown[] = [status];
    let paramIndex = 2;

    if (status === 'reviewed' && options.reviewedBy) {
      updates.push(`reviewed_by = $${paramIndex++}, reviewed_at = NOW()`);
      params.push(options.reviewedBy);
    }

    if (status === 'approved' && options.approvedBy) {
      updates.push(`approved_by = $${paramIndex++}, approved_at = NOW()`);
      params.push(options.approvedBy);
    }

    if (options.lastVerifiedAt) {
      updates.push(`last_verified_at = $${paramIndex++}`);
      params.push(options.lastVerifiedAt);
    }

    params.push(id);
    await db.query(`UPDATE compliance_evidence SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);

    logger.info('Compliance evidence status updated', { id, status });
    return this.getEvidence(id);
  }

  async getEvidenceByFramework(
    complianceFramework: ComplianceEvidence['complianceFramework'],
    filters: {
      controlId?: string;
      status?: ComplianceEvidence['status'];
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ evidence: ComplianceEvidence[]; total: number }> {
    let query = 'SELECT * FROM compliance_evidence WHERE compliance_framework = $1';
    const params: unknown[] = [complianceFramework];
    let paramIndex = 2;

    if (filters.controlId) {
      query += ` AND control_id = $${paramIndex++}`;
      params.push(filters.controlId);
    }
    if (filters.status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await db.query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    query += ' ORDER BY created_at DESC';
    if (filters.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }
    if (filters.offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(filters.offset);
    }

    const result = await db.query<{
      id: string;
      compliance_framework: string;
      control_id: string;
      control_name: string;
      evidence_type: string;
      evidence_url: string | null;
      evidence_data: unknown;
      status: string;
      reviewed_by: string | null;
      reviewed_at: Date | null;
      approved_by: string | null;
      approved_at: Date | null;
      effective_from: Date | null;
      effective_to: Date | null;
      last_verified_at: Date | null;
      next_review_due: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(query, params);

    return {
      evidence: result.rows.map((row) => ({
        id: row.id,
        complianceFramework: row.compliance_framework as ComplianceEvidence['complianceFramework'],
        controlId: row.control_id,
        controlName: row.control_name,
        evidenceType: row.evidence_type as ComplianceEvidence['evidenceType'],
        evidenceUrl: row.evidence_url || undefined,
        evidenceData: row.evidence_data as Record<string, unknown> | undefined,
        status: row.status as ComplianceEvidence['status'],
        reviewedBy: row.reviewed_by as UserId | undefined,
        reviewedAt: row.reviewed_at || undefined,
        approvedBy: row.approved_by as UserId | undefined,
        approvedAt: row.approved_at || undefined,
        effectiveFrom: row.effective_from || undefined,
        effectiveTo: row.effective_to || undefined,
        lastVerifiedAt: row.last_verified_at || undefined,
        nextReviewDue: row.next_review_due || undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      total,
    };
  }

  async getDueReviews(): Promise<ComplianceEvidence[]> {
    const result = await db.query<{
      id: string;
      compliance_framework: string;
      control_id: string;
      control_name: string;
      evidence_type: string;
      evidence_url: string | null;
      evidence_data: unknown;
      status: string;
      reviewed_by: string | null;
      reviewed_at: Date | null;
      approved_by: string | null;
      approved_at: Date | null;
      effective_from: Date | null;
      effective_to: Date | null;
      last_verified_at: Date | null;
      next_review_due: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT * FROM compliance_evidence
       WHERE next_review_due IS NOT NULL
         AND next_review_due <= NOW()
         AND status != 'expired'
       ORDER BY next_review_due ASC`
    );

    return result.rows.map((row) => ({
      id: row.id,
      complianceFramework: row.compliance_framework as ComplianceEvidence['complianceFramework'],
      controlId: row.control_id,
      controlName: row.control_name,
      evidenceType: row.evidence_type as ComplianceEvidence['evidenceType'],
      evidenceUrl: row.evidence_url || undefined,
      evidenceData: row.evidence_data as Record<string, unknown> | undefined,
      status: row.status as ComplianceEvidence['status'],
      reviewedBy: row.reviewed_by as UserId | undefined,
      reviewedAt: row.reviewed_at || undefined,
      approvedBy: row.approved_by as UserId | undefined,
      approvedAt: row.approved_at || undefined,
      effectiveFrom: row.effective_from || undefined,
      effectiveTo: row.effective_to || undefined,
      lastVerifiedAt: row.last_verified_at || undefined,
      nextReviewDue: row.next_review_due || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}

export const complianceEvidenceService = new ComplianceEvidenceService();
