import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('ingestion-rules-service');

export interface IngestionRule {
  id: string;
  tenantId: TenantId;
  ruleName: string;
  ruleType: 'routing' | 'classification' | 'validation' | 'notification';
  priority: number;
  sourceType?: string;
  sourcePattern?: string;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  targetClassification?: string;
  targetWorkflow?: string;
  enabled: boolean;
}

export interface DocumentMetadata {
  sourceType: string;
  source?: string;
  fileType?: string;
  fileSize?: number;
  fileName?: string;
  [key: string]: unknown;
}

export class IngestionRulesService {
  /**
   * Evaluate rules for a document and return actions (Chunk 1)
   */
  async evaluateRules(tenantId: TenantId, metadata: DocumentMetadata): Promise<{
    actions: Record<string, unknown>;
    targetClassification?: string;
    targetWorkflow?: string;
  }> {
    const rules = await this.getEnabledRules(tenantId);

    // Sort by priority (higher first)
    const sortedRules = rules.sort((a, b) => b.priority - a.priority);

    const actions: Record<string, unknown> = {};
    let targetClassification: string | undefined;
    let targetWorkflow: string | undefined;

    for (const rule of sortedRules) {
      if (this.matchesRule(rule, metadata)) {
        // Merge actions
        Object.assign(actions, rule.actions);

        // Override classification if specified
        if (rule.targetClassification) {
          targetClassification = rule.targetClassification;
        }

        // Override workflow if specified
        if (rule.targetWorkflow) {
          targetWorkflow = rule.targetWorkflow;
        }

        logger.debug('Rule matched', {
          tenantId,
          ruleId: rule.id,
          ruleName: rule.ruleName,
          metadata,
        });
      }
    }

    return { actions, targetClassification, targetWorkflow };
  }

  /**
   * Check if document metadata matches rule conditions
   */
  private matchesRule(rule: IngestionRule, metadata: DocumentMetadata): boolean {
    // Check source type
    if (rule.sourceType && metadata.sourceType !== rule.sourceType) {
      return false;
    }

    // Check source pattern (e.g., email domain, webhook provider)
    if (rule.sourcePattern && metadata.source) {
      const pattern = new RegExp(rule.sourcePattern);
      if (!pattern.test(metadata.source)) {
        return false;
      }
    }

    // Check additional conditions
    for (const [key, value] of Object.entries(rule.conditions)) {
      const metadataValue = metadata[key];
      
      if (value === null || value === undefined) {
        continue;
      }

      // Support simple equality and pattern matching
      if (typeof value === 'string' && value.startsWith('regex:')) {
        const regex = new RegExp(value.slice(6));
        if (!regex.test(String(metadataValue))) {
          return false;
        }
      } else if (typeof value === 'object' && value !== null) {
        // Support MongoDB-style operators
        const operators = value as Record<string, unknown>;
        if (operators.$eq !== undefined && metadataValue !== operators.$eq) {
          return false;
        }
        if (operators.$ne !== undefined && metadataValue === operators.$ne) {
          return false;
        }
        if (operators.$gt !== undefined && Number(metadataValue) <= Number(operators.$gt)) {
          return false;
        }
        if (operators.$lt !== undefined && Number(metadataValue) >= Number(operators.$lt)) {
          return false;
        }
        if (operators.$in !== undefined && Array.isArray(operators.$in) && !operators.$in.includes(metadataValue)) {
          return false;
        }
      } else if (metadataValue !== value) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get enabled rules for tenant
   */
  async getEnabledRules(tenantId: TenantId): Promise<IngestionRule[]> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      rule_name: string;
      rule_type: string;
      priority: number;
      source_type: string | null;
      source_pattern: string | null;
      conditions: unknown;
      actions: unknown;
      target_classification: string | null;
      target_workflow: string | null;
      enabled: boolean;
    }>(
      `SELECT id, tenant_id, rule_name, rule_type, priority,
              source_type, source_pattern, conditions, actions,
              target_classification, target_workflow, enabled
       FROM ingestion_rules
       WHERE tenant_id = $1 AND enabled = true
       ORDER BY priority DESC`,
      [tenantId]
    );

    return result.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      ruleName: row.rule_name,
      ruleType: row.rule_type as IngestionRule['ruleType'],
      priority: row.priority,
      sourceType: row.source_type || undefined,
      sourcePattern: row.source_pattern || undefined,
      conditions: (row.conditions as Record<string, unknown>) || {},
      actions: (row.actions as Record<string, unknown>) || {},
      targetClassification: row.target_classification || undefined,
      targetWorkflow: row.target_workflow || undefined,
      enabled: row.enabled,
    }));
  }

  /**
   * Create ingestion rule
   */
  async createRule(
    tenantId: TenantId,
    userId: string,
    rule: Omit<IngestionRule, 'id' | 'tenantId' | 'enabled'>
  ): Promise<string> {
    const result = await db.query<{ id: string }>(
      `INSERT INTO ingestion_rules (
        id, tenant_id, rule_name, rule_type, priority,
        source_type, source_pattern, conditions, actions,
        target_classification, target_workflow, enabled, created_by, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb,
        $9, $10, true, $11, NOW(), NOW()
      ) RETURNING id`,
      [
        tenantId,
        rule.ruleName,
        rule.ruleType,
        rule.priority,
        rule.sourceType || null,
        rule.sourcePattern || null,
        JSON.stringify(rule.conditions),
        JSON.stringify(rule.actions),
        rule.targetClassification || null,
        rule.targetWorkflow || null,
        userId,
      ]
    );

    return result.rows[0].id;
  }

  /**
   * Update rule
   */
  async updateRule(
    ruleId: string,
    tenantId: TenantId,
    updates: Partial<IngestionRule>
  ): Promise<void> {
    const updatesList: string[] = [];
    const params: unknown[] = [];
    let paramCount = 1;

    if (updates.ruleName !== undefined) {
      updatesList.push(`rule_name = $${paramCount++}`);
      params.push(updates.ruleName);
    }
    if (updates.priority !== undefined) {
      updatesList.push(`priority = $${paramCount++}`);
      params.push(updates.priority);
    }
    if (updates.conditions !== undefined) {
      updatesList.push(`conditions = $${paramCount++}::jsonb`);
      params.push(JSON.stringify(updates.conditions));
    }
    if (updates.actions !== undefined) {
      updatesList.push(`actions = $${paramCount++}::jsonb`);
      params.push(JSON.stringify(updates.actions));
    }
    if (updates.enabled !== undefined) {
      updatesList.push(`enabled = $${paramCount++}`);
      params.push(updates.enabled);
    }

    if (updatesList.length === 0) {
      return;
    }

    updatesList.push(`updated_at = NOW()`);
    params.push(ruleId, tenantId);

    await db.query(
      `UPDATE ingestion_rules
       SET ${updatesList.join(', ')}
       WHERE id = $${paramCount} AND tenant_id = $${paramCount + 1}`,
      params
    );
  }

  /**
   * Delete rule
   */
  async deleteRule(ruleId: string, tenantId: TenantId): Promise<void> {
    await db.query(
      `DELETE FROM ingestion_rules
       WHERE id = $1 AND tenant_id = $2`,
      [ruleId, tenantId]
    );
  }
}

export const ingestionRulesService = new IngestionRulesService();
