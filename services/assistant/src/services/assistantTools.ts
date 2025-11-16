import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import { rulepackRegistryService } from '@ai-accountant/rules-engine-service/services/rulepackRegistry';
import { applyTaxRules } from '@ai-accountant/rules-engine-service/services/taxRules';

const logger = createLogger('assistant-tools');

export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

/**
 * Assistant Tools Service (Chunk 3)
 * Provides tools for AI assistant to interact with tax and filing systems
 */
export class AssistantToolsService {
  /**
   * Get ledger slice for analysis
   */
  async getLedgerSlice(
    tenantId: TenantId,
    startDate: Date,
    endDate: Date,
    accountCodes?: string[]
  ): Promise<Record<string, unknown>> {
    let query = `SELECT * FROM ledger_entries
                 WHERE tenant_id = $1
                   AND transaction_date BETWEEN $2 AND $3`;
    const params: unknown[] = [tenantId, startDate, endDate];

    if (accountCodes && accountCodes.length > 0) {
      query += ` AND account_code = ANY($4)`;
      params.push(accountCodes);
    }

    query += ` ORDER BY transaction_date ASC`;

    const result = await db.query(query, params);

    return {
      entries: result.rows,
      count: result.rows.length,
      totalDebit: result.rows.reduce((sum, row) => sum + (Number(row.debit_amount) || 0), 0),
      totalCredit: result.rows.reduce((sum, row) => sum + (Number(row.credit_amount) || 0), 0),
    };
  }

  /**
   * Calculate tax for transaction
   */
  async calculateTax(
    tenantId: TenantId,
    jurisdiction: string,
    transaction: {
      amount: number;
      category?: string;
      description?: string;
      vendor?: string;
    }
  ): Promise<{
    taxRate: number | null;
    taxAmount: number;
    ruleId: string;
    reasoning?: string;
    rulepackVersion?: string;
  }> {
    // Get active rulepack
    const rulepack = await rulepackRegistryService.getActiveRulepack(jurisdiction);
    if (!rulepack) {
      throw new Error(`No active rulepack found for jurisdiction: ${jurisdiction}`);
    }

    // Calculate tax
    const result = await applyTaxRules(jurisdiction, transaction);

    return {
      ...result,
      rulepackVersion: rulepack.version,
    };
  }

  /**
   * Generate filing draft
   */
  async generateFilingDraft(
    tenantId: TenantId,
    filingType: string,
    jurisdiction: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<{
    filingId: string;
    status: string;
    amounts: Record<string, number>;
  }> {
    // Import filing service
    const { filingLifecycleService } = await import('@ai-accountant/filing-service/services/filingLifecycle');

    const draft = await filingLifecycleService.createDraft(
      tenantId,
      {
        filingType,
        jurisdiction,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        dueDate: periodEnd.toISOString().split('T')[0],
      },
      'system' as UserId
    );

    return {
      filingId: draft.id,
      status: draft.status,
      amounts: draft.filingData as Record<string, number>,
    };
  }

  /**
   * Get rule explanation
   */
  async getRuleExplanation(
    jurisdiction: string,
    ruleId: string
  ): Promise<{
    ruleId: string;
    name: string;
    description: string;
    condition: string;
    action: string;
    examples: string[];
  }> {
    const rulepack = await rulepackRegistryService.getActiveRulepack(jurisdiction);
    if (!rulepack) {
      throw new Error(`No active rulepack found for jurisdiction: ${jurisdiction}`);
    }

    const rules = (rulepack.rulepackData.rules as Array<{
      id: string;
      name: string;
      description: string;
      condition: string;
      action: string;
    }>) || [];

    const rule = rules.find(r => r.id === ruleId);
    if (!rule) {
      throw new Error(`Rule not found: ${ruleId}`);
    }

    return {
      ruleId: rule.id,
      name: rule.name,
      description: rule.description,
      condition: rule.condition,
      action: rule.action,
      examples: [], // Would be populated from rulepack metadata
    };
  }

  /**
   * Create task
   */
  async createTask(
    tenantId: TenantId,
    title: string,
    description: string,
    assignedTo?: UserId,
    priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal'
  ): Promise<{
    taskId: string;
    status: string;
  }> {
    // In production, would create task in task management system
    // For now, return mock
    return {
      taskId: require('crypto').randomUUID(),
      status: 'created',
    };
  }
}

export const assistantToolsService = new AssistantToolsService();
