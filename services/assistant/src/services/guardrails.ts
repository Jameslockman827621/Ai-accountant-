/**
 * Guardrails & Compliance Service
 * Implements policy engine for checking prompts/responses and tool calls
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';

const logger = createLogger('assistant-guardrails');

export interface GuardrailCheck {
  allowed: boolean;
  reason?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export class GuardrailService {
  /**
   * Prohibited patterns for prompts
   */
  private readonly PROHIBITED_PROMPT_PATTERNS = [
    /delete\s+all/i,
    /wipe\s+data/i,
    /remove\s+everything/i,
    /bypass\s+security/i,
    /hack/i,
    /exploit/i,
  ];

  /**
   * Prohibited patterns for responses
   */
  private readonly PROHIBITED_RESPONSE_PATTERNS = [
    /guaranteed\s+profit/i,
    /risk-free/i,
    /100%\s+accurate/i,
    /no\s+errors/i,
  ];

  /**
   * PII patterns to detect
   */
  private readonly PII_PATTERNS = [
    /\b\d{3}-\d{2}-\d{4}\b/, // SSN
    /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/, // Credit card
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email (context-dependent)
  ];

  /**
   * Check if prompt is allowed
   */
  async checkPrompt(tenantId: TenantId, prompt: string): Promise<GuardrailCheck> {
    // Check prohibited patterns
    for (const pattern of this.PROHIBITED_PROMPT_PATTERNS) {
      if (pattern.test(prompt)) {
        await this.logViolation(tenantId, 'prompt', prompt, 'Prohibited pattern detected');
        return {
          allowed: false,
          reason: 'Prohibited action detected',
          severity: 'high',
        };
      }
    }

    // Check for potential PII leakage (in production, would be more sophisticated)
    // For now, just log if suspicious patterns found
    const piiMatches = this.PII_PATTERNS.filter(pattern => pattern.test(prompt));
    if (piiMatches.length > 0) {
      logger.warn('Potential PII detected in prompt', { tenantId, patternCount: piiMatches.length });
    }

    return { allowed: true };
  }

  /**
   * Check if response is allowed
   */
  async checkResponse(tenantId: TenantId, response: string): Promise<GuardrailCheck> {
    // Check prohibited patterns
    for (const pattern of this.PROHIBITED_RESPONSE_PATTERNS) {
      if (pattern.test(response)) {
        await this.logViolation(tenantId, 'response', response, 'Prohibited claim detected');
        return {
          allowed: false,
          reason: 'Response contains unsupported claims',
          severity: 'medium',
        };
      }
    }

    // Check for PII in response
    const piiMatches = this.PII_PATTERNS.filter(pattern => pattern.test(response));
    if (piiMatches.length > 0) {
      await this.logViolation(tenantId, 'response', response, 'PII detected in response');
      return {
        allowed: false,
        reason: 'Response may contain sensitive information',
        severity: 'critical',
      };
    }

    return { allowed: true };
  }

  /**
   * Check if tool call is allowed
   */
  async checkToolCall(
    tenantId: TenantId,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<GuardrailCheck> {
    // Check for prohibited tool combinations or dangerous arguments
    if (toolName === 'initiate_filing_submission') {
      // Additional checks for filing submission
      const filingId = args.filingId as string;
      if (!filingId) {
        return {
          allowed: false,
          reason: 'Filing ID is required',
          severity: 'medium',
        };
      }

      // Check if filing exists and is in correct state
      const filingCheck = await db.query<{ status: string }>(
        `SELECT status FROM filings WHERE id = $1 AND tenant_id = $2`,
        [filingId, tenantId]
      );

      if (filingCheck.rows.length === 0) {
        return {
          allowed: false,
          reason: 'Filing not found',
          severity: 'medium',
        };
      }

      if (filingCheck.rows[0].status !== 'pending_approval') {
        return {
          allowed: false,
          reason: `Filing is not in pending_approval status (current: ${filingCheck.rows[0].status})`,
          severity: 'high',
        };
      }
    }

    // Check for suspicious amounts in journal entries
    if (toolName === 'post_journal_entry') {
      const entries = args.entries as Array<{ debitAmount?: number; creditAmount?: number }> | undefined;
      if (entries) {
        for (const entry of entries) {
          const amount = entry.debitAmount || entry.creditAmount || 0;
          if (Math.abs(amount) > 1000000) {
            // Flag large amounts for review
            logger.warn('Large journal entry amount detected', { tenantId, amount });
          }
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Log guardrail violation
   */
  private async logViolation(
    tenantId: TenantId,
    type: 'prompt' | 'response' | 'tool_call',
    content: string,
    reason: string
  ): Promise<void> {
    try {
      await db.query(
        `INSERT INTO audit_logs (tenant_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'guardrail_violation', $2, gen_random_uuid(), $3::jsonb)`,
        [
          tenantId,
          type,
          JSON.stringify({
            reason,
            contentLength: content.length,
            timestamp: new Date().toISOString(),
          }),
        ]
      );

      logger.warn('Guardrail violation logged', { tenantId, type, reason });
    } catch (error) {
      logger.error('Failed to log guardrail violation', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get violation statistics
   */
  async getViolationStats(tenantId: TenantId, days: number = 30): Promise<{
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const result = await db.query<{
      resource_type: string;
      severity: string;
      count: string;
    }>(
      `SELECT 
        resource_type,
        (metadata->>'severity')::text as severity,
        COUNT(*) as count
       FROM audit_logs
       WHERE tenant_id = $1
         AND action = 'guardrail_violation'
         AND created_at > $2
       GROUP BY resource_type, severity`,
      [tenantId, since]
    );

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const row of result.rows) {
      byType[row.resource_type] = (byType[row.resource_type] || 0) + parseInt(row.count, 10);
      const severity = row.severity || 'unknown';
      bySeverity[severity] = (bySeverity[severity] || 0) + parseInt(row.count, 10);
    }

    return {
      total: result.rows.reduce((sum, row) => sum + parseInt(row.count, 10), 0),
      byType,
      bySeverity,
    };
  }
}

export const guardrailService = new GuardrailService();
