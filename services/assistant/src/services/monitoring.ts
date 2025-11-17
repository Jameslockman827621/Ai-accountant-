/**
 * Production Monitoring Service
 * Samples conversations for human review and collects user feedback
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';

const logger = createLogger('assistant-monitoring');

export interface ConversationSample {
  conversationId: string;
  tenantId: TenantId;
  userId: UserId;
  question: string;
  answer: string;
  toolCalls: Array<{ toolName: string; success: boolean }>;
  confidenceScore: number;
  citationsCount: number;
  sampledAt: Date;
}

export interface UserFeedback {
  conversationId: string;
  feedback: 'thumbs_up' | 'thumbs_down' | 'neutral';
  notes?: string;
  userId: UserId;
}

export class MonitoringService {
  /**
   * Sample percentage of conversations for review
   */
  private readonly SAMPLE_RATE = parseFloat(process.env.ASSISTANT_SAMPLE_RATE || '0.05'); // 5%

  /**
   * Determine if conversation should be sampled
   */
  shouldSample(confidenceScore: number, toolCallsCount: number): boolean {
    // Always sample low confidence or tool call failures
    if (confidenceScore < 0.7 || toolCallsCount > 0) {
      return Math.random() < this.SAMPLE_RATE * 2; // Double rate for these
    }

    return Math.random() < this.SAMPLE_RATE;
  }

  /**
   * Log conversation sample for review
   */
  async logSample(sample: ConversationSample): Promise<void> {
    try {
      await db.query(
        `INSERT INTO assistant_conversation_samples (
          conversation_id, tenant_id, user_id, question, answer,
          tool_calls, confidence_score, citations_count, sampled_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
        [
          sample.conversationId,
          sample.tenantId,
          sample.userId,
          sample.question,
          sample.answer,
          JSON.stringify(sample.toolCalls),
          sample.confidenceScore,
          sample.citationsCount,
          sample.sampledAt,
        ]
      );
    } catch (error) {
      logger.error('Failed to log conversation sample', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Record user feedback
   */
  async recordFeedback(feedback: UserFeedback): Promise<void> {
    try {
      await db.query(
        `INSERT INTO assistant_feedback (
          conversation_id, user_id, feedback, notes, created_at
        ) VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (conversation_id, user_id) 
        DO UPDATE SET feedback = $3, notes = $4, updated_at = NOW()`,
        [feedback.conversationId, feedback.userId, feedback.feedback, feedback.notes || null]
      );

      // Update sample if exists
      await db.query(
        `UPDATE assistant_conversation_samples
         SET feedback = $1, feedback_notes = $2, feedback_at = NOW()
         WHERE conversation_id = $3`,
        [feedback.feedback, feedback.notes || null, feedback.conversationId]
      );
    } catch (error) {
      logger.error('Failed to record feedback', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get samples pending review
   */
  async getPendingSamples(tenantId?: TenantId, limit: number = 50): Promise<ConversationSample[]> {
    const query = tenantId
      ? `SELECT * FROM assistant_conversation_samples
         WHERE tenant_id = $1 AND feedback IS NULL
         ORDER BY sampled_at DESC
         LIMIT $2`
      : `SELECT * FROM assistant_conversation_samples
         WHERE feedback IS NULL
         ORDER BY sampled_at DESC
         LIMIT $1`;

    const params = tenantId ? [tenantId, limit] : [limit];

    const result = await db.query(query, params);

    return result.rows.map(row => ({
      conversationId: row.conversation_id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      question: row.question,
      answer: row.answer,
      toolCalls: (row.tool_calls as Array<{ toolName: string; success: boolean }>) || [],
      confidenceScore: parseFloat(row.confidence_score),
      citationsCount: parseInt(row.citations_count, 10),
      sampledAt: row.sampled_at,
    }));
  }

  /**
   * Get feedback statistics
   */
  async getFeedbackStats(tenantId: TenantId, days: number = 30): Promise<{
    total: number;
    thumbsUp: number;
    thumbsDown: number;
    neutral: number;
    averageConfidence: number;
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const result = await db.query<{
      feedback: string;
      confidence_score: string;
      count: string;
    }>(
      `SELECT 
        feedback,
        AVG(confidence_score) as confidence_score,
        COUNT(*) as count
       FROM assistant_feedback af
       JOIN assistant_conversation_samples acs ON af.conversation_id = acs.conversation_id
       WHERE acs.tenant_id = $1
         AND af.created_at > $2
       GROUP BY feedback`,
      [tenantId, since]
    );

    let total = 0;
    let thumbsUp = 0;
    let thumbsDown = 0;
    let neutral = 0;
    let confidenceSum = 0;

    for (const row of result.rows) {
      const count = parseInt(row.count, 10);
      total += count;

      if (row.feedback === 'thumbs_up') {
        thumbsUp += count;
      } else if (row.feedback === 'thumbs_down') {
        thumbsDown += count;
      } else {
        neutral += count;
      }

      confidenceSum += parseFloat(row.confidence_score || '0') * count;
    }

    return {
      total,
      thumbsUp,
      thumbsDown,
      neutral,
      averageConfidence: total > 0 ? confidenceSum / total : 0,
    };
  }
}

export const monitoringService = new MonitoringService();
