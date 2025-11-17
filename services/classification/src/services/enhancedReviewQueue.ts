import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, DocumentId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('enhanced-review-queue');

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ReviewQueueItem {
  id: string;
  documentId: DocumentId;
  priorityScore: number;
  riskLevel: RiskLevel;
  riskFactors: string[];
  assignedTo?: UserId;
  assignedAt?: Date;
  reviewerSkillRequired?: string;
  status: 'pending' | 'assigned' | 'in_review' | 'approved' | 'rejected' | 'escalated';
  slaDeadline?: Date;
  timeToFirstReview?: number;
  reviewCompletedAt?: Date;
  createdAt: Date;
}

export interface ReviewerSkill {
  userId: UserId;
  skillType: string;
  proficiencyLevel: number;
  documentsReviewed: number;
  averageReviewTime: number;
  accuracyRate: number;
  specialties: string[];
}

export class EnhancedReviewQueueManager {
  /**
   * Add document to review queue with risk-based prioritization
   */
  async addToQueue(
    tenantId: TenantId,
    documentId: DocumentId,
    options?: {
      confidenceScore?: number;
      qualityScore?: number;
      amount?: number;
      complianceFlags?: string[];
      documentType?: string;
    }
  ): Promise<string> {
    // Calculate risk level and priority score
    const { riskLevel, priorityScore, riskFactors } = this.calculateRisk(
      options?.confidenceScore || 0,
      options?.qualityScore || 100,
      options?.amount || 0,
      options?.complianceFlags || [],
      options?.documentType
    );

    // Determine required reviewer skill
    const reviewerSkillRequired = this.determineRequiredSkill(riskLevel, options?.complianceFlags || []);

    // Calculate SLA deadline (4 hours for high risk, 24 hours for others)
    const slaDeadline = new Date();
    if (riskLevel === 'critical' || riskLevel === 'high') {
      slaDeadline.setHours(slaDeadline.getHours() + 4);
    } else {
      slaDeadline.setHours(slaDeadline.getHours() + 24);
    }

    const queueId = randomUUID();

    await db.query(
      `INSERT INTO review_queue (
        id, tenant_id, document_id, priority_score, risk_level, risk_factors,
        reviewer_skill_required, status, sla_deadline, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, NOW(), NOW())
      ON CONFLICT (document_id) DO UPDATE SET
        priority_score = EXCLUDED.priority_score,
        risk_level = EXCLUDED.risk_level,
        risk_factors = EXCLUDED.risk_factors,
        reviewer_skill_required = EXCLUDED.reviewer_skill_required,
        sla_deadline = EXCLUDED.sla_deadline,
        updated_at = NOW()`,
      [
        queueId,
        tenantId,
        documentId,
        priorityScore,
        riskLevel,
        JSON.stringify(riskFactors),
        reviewerSkillRequired || null,
        'pending',
        slaDeadline,
      ]
    );

    logger.info('Document added to review queue', {
      queueId,
      documentId,
      riskLevel,
      priorityScore,
      riskFactors,
    });

    return queueId;
  }

  /**
   * Calculate risk level and priority score
   */
  private calculateRisk(
    confidenceScore: number,
    qualityScore: number,
    amount: number,
    complianceFlags: string[],
    documentType?: string
  ): { riskLevel: RiskLevel; priorityScore: number; riskFactors: string[] } {
    const riskFactors: string[] = [];
    let riskScore = 0;

    // Confidence-based risk
    if (confidenceScore < 0.5) {
      riskScore += 40;
      riskFactors.push('Very low confidence');
    } else if (confidenceScore < 0.7) {
      riskScore += 20;
      riskFactors.push('Low confidence');
    }

    // Quality-based risk
    if (qualityScore < 50) {
      riskScore += 30;
      riskFactors.push('Poor quality');
    } else if (qualityScore < 70) {
      riskScore += 15;
      riskFactors.push('Below average quality');
    }

    // Amount-based risk
    if (amount > 10000) {
      riskScore += 25;
      riskFactors.push('High amount');
    } else if (amount > 5000) {
      riskScore += 10;
      riskFactors.push('Moderate amount');
    }

    // Compliance flags
    if (complianceFlags.length > 0) {
      riskScore += complianceFlags.length * 15;
      riskFactors.push(...complianceFlags.map((flag) => `Compliance: ${flag}`));
    }

    // Document type risk
    if (documentType === 'tax_form' || documentType === 'filing') {
      riskScore += 20;
      riskFactors.push('Tax-related document');
    }

    // Determine risk level
    let riskLevel: RiskLevel;
    if (riskScore >= 70) {
      riskLevel = 'critical';
    } else if (riskScore >= 50) {
      riskLevel = 'high';
    } else if (riskScore >= 30) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }

    // Priority score (0-100, higher = more urgent)
    const priorityScore = Math.min(100, riskScore);

    return { riskLevel, priorityScore, riskFactors };
  }

  /**
   * Determine required reviewer skill based on risk
   */
  private determineRequiredSkill(riskLevel: RiskLevel, complianceFlags: string[]): string | undefined {
    if (riskLevel === 'critical' || complianceFlags.length > 0) {
      return 'senior_accountant';
    }
    if (riskLevel === 'high') {
      return 'general';
    }
    return undefined; // Any reviewer can handle low/medium risk
  }

  /**
   * Get review queue with intelligent prioritization
   */
  async getQueue(
    tenantId: TenantId,
    options?: {
      riskLevel?: RiskLevel;
      assignedTo?: UserId;
      status?: ReviewQueueItem['status'];
      limit?: number;
      reviewerSkill?: string;
    }
  ): Promise<ReviewQueueItem[]> {
    let query = `
      SELECT id, document_id, priority_score, risk_level, risk_factors,
             assigned_to, assigned_at, reviewer_skill_required, status,
             sla_deadline, time_to_first_review, review_completed_at, created_at
      FROM review_queue
      WHERE tenant_id = $1
    `;
    const params: unknown[] = [tenantId];
    let paramCount = 2;

    if (options?.riskLevel) {
      query += ` AND risk_level = $${paramCount++}`;
      params.push(options.riskLevel);
    }

    if (options?.assignedTo) {
      query += ` AND assigned_to = $${paramCount++}`;
      params.push(options.assignedTo);
    } else if (options?.status === 'pending' || !options?.status) {
      query += ` AND (assigned_to IS NULL OR status = 'pending')`;
    }

    if (options?.status) {
      query += ` AND status = $${paramCount++}`;
      params.push(options.status);
    }

    if (options?.reviewerSkill) {
      query += ` AND (reviewer_skill_required IS NULL OR reviewer_skill_required = $${paramCount++})`;
      params.push(options.reviewerSkill);
    }

    // Order by priority (highest first), then by SLA deadline (earliest first)
    query += ` ORDER BY priority_score DESC, sla_deadline ASC NULLS LAST`;

    if (options?.limit) {
      query += ` LIMIT $${paramCount++}`;
      params.push(options.limit);
    } else {
      query += ` LIMIT 50`;
    }

    const result = await db.query<{
      id: string;
      document_id: string;
      priority_score: number;
      risk_level: string;
      risk_factors: unknown;
      assigned_to: string | null;
      assigned_at: Date | null;
      reviewer_skill_required: string | null;
      status: string;
      sla_deadline: Date | null;
      time_to_first_review: number | null;
      review_completed_at: Date | null;
      created_at: Date;
    }>(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      documentId: row.document_id as DocumentId,
      priorityScore: parseFloat(row.priority_score.toString()),
      riskLevel: row.risk_level as RiskLevel,
      riskFactors: (row.risk_factors as string[]) || [],
      assignedTo: row.assigned_to as UserId | undefined,
      assignedAt: row.assigned_at || undefined,
      reviewerSkillRequired: row.reviewer_skill_required || undefined,
      status: row.status as ReviewQueueItem['status'],
      slaDeadline: row.sla_deadline || undefined,
      timeToFirstReview: row.time_to_first_review || undefined,
      reviewCompletedAt: row.review_completed_at || undefined,
      createdAt: row.created_at,
    }));
  }

  /**
   * Assign queue item to reviewer (with skill matching)
   */
  async assignToReviewer(
    queueId: string,
    reviewerId: UserId,
    tenantId: TenantId
  ): Promise<void> {
    const startTime = Date.now();

    await db.query(
      `UPDATE review_queue
       SET assigned_to = $1, assigned_at = NOW(), status = 'assigned', updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 AND status = 'pending'`,
      [reviewerId, queueId, tenantId]
    );

    // Calculate time to first review
    const queueResult = await db.query<{ created_at: Date }>(
      `SELECT created_at FROM review_queue WHERE id = $1`,
      [queueId]
    );

    if (queueResult.rows.length > 0) {
      const timeToFirstReview = Math.floor(
        (startTime - queueResult.rows[0].created_at.getTime()) / 1000
      );

      await db.query(
        `UPDATE review_queue
         SET time_to_first_review = $1, updated_at = NOW()
         WHERE id = $2`,
        [timeToFirstReview, queueId]
      );
    }

    logger.info('Review item assigned', { queueId, reviewerId });
  }

  /**
   * Auto-assign based on reviewer skills
   */
  async autoAssign(tenantId: TenantId, reviewerId: UserId): Promise<number> {
    // Get reviewer skills
    const skillsResult = await db.query<{
      skill_type: string;
      proficiency_level: number;
      specialties: string[];
    }>(
      `SELECT skill_type, proficiency_level, specialties
       FROM reviewer_skills
       WHERE user_id = $1`,
      [reviewerId]
    );

    const reviewerSkills = skillsResult.rows.map((row) => ({
      skillType: row.skill_type,
      proficiencyLevel: row.proficiency_level,
      specialties: row.specialties || [],
    }));

    // Get pending items that match reviewer skills
    const queueItems = await this.getQueue(tenantId, {
      status: 'pending',
      limit: 10,
    });

    let assignedCount = 0;

    for (const item of queueItems) {
      // Check if reviewer has required skill
      if (item.reviewerSkillRequired) {
        const hasSkill = reviewerSkills.some(
          (skill) =>
            skill.skillType === item.reviewerSkillRequired ||
            skill.specialties.includes(item.reviewerSkillRequired || '')
        );

        if (!hasSkill) {
          continue; // Skip if reviewer doesn't have required skill
        }
      }

      // Assign item
      await this.assignToReviewer(item.id, reviewerId, tenantId);
      assignedCount++;
    }

    return assignedCount;
  }

  /**
   * Complete review with action
   */
  async completeReview(
    queueId: string,
    reviewerId: UserId,
    action: 'approve' | 'edit' | 'reject' | 'escalate',
    data?: {
      fieldCorrections?: Record<string, unknown>;
      ledgerCorrections?: Record<string, unknown>;
      notes?: string;
      confidenceOverride?: number;
    }
  ): Promise<void> {
    const startTime = Date.now();

    // Get review start time
    const queueResult = await db.query<{ assigned_at: Date | null }>(
      `SELECT assigned_at FROM review_queue WHERE id = $1`,
      [queueId]
    );

    const processingTime = queueResult.rows[0]?.assigned_at
      ? Math.floor((startTime - queueResult.rows[0].assigned_at.getTime()) / 1000)
      : null;

    // Record reviewer action
    const actionId = randomUUID();
    await db.query(
      `INSERT INTO reviewer_actions (
        id, review_queue_id, reviewer_id, action_type, field_corrections,
        ledger_corrections, notes, confidence_override, processing_time_seconds, created_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, NOW())`,
      [
        actionId,
        queueId,
        reviewerId,
        action,
        JSON.stringify(data?.fieldCorrections || {}),
        JSON.stringify(data?.ledgerCorrections || {}),
        data?.notes || null,
        data?.confidenceOverride || null,
        processingTime,
      ]
    );

    // Update queue status
    const newStatus =
      action === 'approve'
        ? 'approved'
        : action === 'reject'
        ? 'rejected'
        : action === 'escalate'
        ? 'escalated'
        : 'in_review';

    await db.query(
      `UPDATE review_queue
       SET status = $1, review_completed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [newStatus, queueId]
    );

    logger.info('Review completed', { queueId, reviewerId, action, processingTime });
  }
}

export const enhancedReviewQueueManager = new EnhancedReviewQueueManager();
