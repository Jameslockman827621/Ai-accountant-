import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('compliance-service');

export interface AccessReview {
  id: string;
  reviewType: 'user_access' | 'role_permissions' | 'api_keys' | 'service_accounts';
  tenantId?: TenantId;
  userId?: UserId;
  resourceType?: string;
  resourceId?: string;
  reviewedBy: UserId;
  reviewedAt: Date;
  reviewStatus: 'approved' | 'revoked' | 'needs_justification';
  currentPermissions?: Record<string, unknown>;
  recommendedChanges?: Record<string, unknown>;
  justification?: string;
  reviewNotes?: string;
  actionTaken?: string;
  actionTakenAt?: Date;
  actionTakenBy?: UserId;
  metadata?: Record<string, unknown>;
}

export class AccessReviewService {
  async createReview(
    reviewType: AccessReview['reviewType'],
    reviewedBy: UserId,
    options: {
      tenantId?: TenantId;
      userId?: UserId;
      resourceType?: string;
      resourceId?: string;
      currentPermissions?: Record<string, unknown>;
      recommendedChanges?: Record<string, unknown>;
      justification?: string;
      reviewNotes?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<AccessReview> {
    const id = randomUUID();

    await db.query(
      `INSERT INTO access_reviews (
        id, review_type, tenant_id, user_id, resource_type, resource_id,
        reviewed_by, reviewed_at, review_status, current_permissions,
        recommended_changes, justification, review_notes, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9::jsonb, $10::jsonb, $11, $12, $13::jsonb)`,
      [
        id,
        reviewType,
        options.tenantId || null,
        options.userId || null,
        options.resourceType || null,
        options.resourceId || null,
        reviewedBy,
        'needs_justification',
        options.currentPermissions ? JSON.stringify(options.currentPermissions) : null,
        options.recommendedChanges ? JSON.stringify(options.recommendedChanges) : null,
        options.justification || null,
        options.reviewNotes || null,
        options.metadata ? JSON.stringify(options.metadata) : null,
      ]
    );

    logger.info('Access review created', { id, reviewType, reviewedBy });
    return this.getReview(id);
  }

  async getReview(id: string): Promise<AccessReview> {
    const result = await db.query<{
      id: string;
      review_type: string;
      tenant_id: string | null;
      user_id: string | null;
      resource_type: string | null;
      resource_id: string | null;
      reviewed_by: string;
      reviewed_at: Date;
      review_status: string;
      current_permissions: unknown;
      recommended_changes: unknown;
      justification: string | null;
      review_notes: string | null;
      action_taken: string | null;
      action_taken_at: Date | null;
      action_taken_by: string | null;
      metadata: unknown;
    }>('SELECT * FROM access_reviews WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new Error(`Access review not found: ${id}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      reviewType: row.review_type as AccessReview['reviewType'],
      tenantId: row.tenant_id as TenantId | undefined,
      userId: row.user_id as UserId | undefined,
      resourceType: row.resource_type || undefined,
      resourceId: row.resource_id || undefined,
      reviewedBy: row.reviewed_by as UserId,
      reviewedAt: row.reviewed_at,
      reviewStatus: row.review_status as AccessReview['reviewStatus'],
      currentPermissions: row.current_permissions as Record<string, unknown> | undefined,
      recommendedChanges: row.recommended_changes as Record<string, unknown> | undefined,
      justification: row.justification || undefined,
      reviewNotes: row.review_notes || undefined,
      actionTaken: row.action_taken || undefined,
      actionTakenAt: row.action_taken_at || undefined,
      actionTakenBy: row.action_taken_by as UserId | undefined,
      metadata: row.metadata as Record<string, unknown> | undefined,
    };
  }

  async updateReviewStatus(
    id: string,
    reviewStatus: AccessReview['reviewStatus'],
    options: {
      reviewNotes?: string;
      actionTaken?: string;
      actionTakenBy?: UserId;
    } = {}
  ): Promise<AccessReview> {
    const updates: string[] = ['review_status = $1'];
    const params: unknown[] = [reviewStatus];
    let paramIndex = 2;

    if (options.reviewNotes) {
      updates.push(`review_notes = $${paramIndex++}`);
      params.push(options.reviewNotes);
    }

    if (options.actionTaken) {
      updates.push(`action_taken = $${paramIndex++}, action_taken_at = NOW()`);
      params.push(options.actionTaken);
      if (options.actionTakenBy) {
        updates.push(`action_taken_by = $${paramIndex++}`);
        params.push(options.actionTakenBy);
      }
    }

    params.push(id);
    await db.query(`UPDATE access_reviews SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);

    logger.info('Access review status updated', { id, reviewStatus });
    return this.getReview(id);
  }

  async getReviews(filters: {
    tenantId?: TenantId;
    userId?: UserId;
    reviewType?: AccessReview['reviewType'];
    reviewStatus?: AccessReview['reviewStatus'];
    limit?: number;
    offset?: number;
  } = {}): Promise<{ reviews: AccessReview[]; total: number }> {
    let query = 'SELECT * FROM access_reviews WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.tenantId) {
      query += ` AND tenant_id = $${paramIndex++}`;
      params.push(filters.tenantId);
    }
    if (filters.userId) {
      query += ` AND user_id = $${paramIndex++}`;
      params.push(filters.userId);
    }
    if (filters.reviewType) {
      query += ` AND review_type = $${paramIndex++}`;
      params.push(filters.reviewType);
    }
    if (filters.reviewStatus) {
      query += ` AND review_status = $${paramIndex++}`;
      params.push(filters.reviewStatus);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await db.query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    query += ' ORDER BY reviewed_at DESC';
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
      review_type: string;
      tenant_id: string | null;
      user_id: string | null;
      resource_type: string | null;
      resource_id: string | null;
      reviewed_by: string;
      reviewed_at: Date;
      review_status: string;
      current_permissions: unknown;
      recommended_changes: unknown;
      justification: string | null;
      review_notes: string | null;
      action_taken: string | null;
      action_taken_at: Date | null;
      action_taken_by: string | null;
      metadata: unknown;
    }>(query, params);

    return {
      reviews: result.rows.map((row) => ({
        id: row.id,
        reviewType: row.review_type as AccessReview['reviewType'],
        tenantId: row.tenant_id as TenantId | undefined,
        userId: row.user_id as UserId | undefined,
        resourceType: row.resource_type || undefined,
        resourceId: row.resource_id || undefined,
        reviewedBy: row.reviewed_by as UserId,
        reviewedAt: row.reviewed_at,
        reviewStatus: row.review_status as AccessReview['reviewStatus'],
        currentPermissions: row.current_permissions as Record<string, unknown> | undefined,
        recommendedChanges: row.recommended_changes as Record<string, unknown> | undefined,
        justification: row.justification || undefined,
        reviewNotes: row.review_notes || undefined,
        actionTaken: row.action_taken || undefined,
        actionTakenAt: row.action_taken_at || undefined,
        actionTakenBy: row.action_taken_by as UserId | undefined,
        metadata: row.metadata as Record<string, unknown> | undefined,
      })),
      total,
    };
  }
}

export const accessReviewService = new AccessReviewService();
