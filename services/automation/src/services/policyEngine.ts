import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('policy-engine');

export type PolicyAction = 'auto' | 'require_review' | 'block';
export type PolicyScope = 'tenant' | 'role' | 'user' | 'playbook';

export interface PolicyRule {
  id: string;
  tenantId: TenantId | null;
  policyName: string;
  policyType: string;
  scope: PolicyScope;
  scopeId: string | null;
  conditions: Record<string, unknown>;
  actions: PolicyAction;
  riskThreshold: number | null;
  priority: number;
  isActive: boolean;
}

export interface PolicyEvaluationResult {
  action: PolicyAction;
  matchedPolicies: string[];
  riskScore: number;
  reasoning: string;
}

export class PolicyEngine {
  /**
   * Evaluate policies for action
   */
  async evaluateAction(
    tenantId: TenantId,
    userId: UserId | null,
    userRole: string | null,
    actionType: string,
    context: Record<string, unknown>
  ): Promise<PolicyEvaluationResult> {
    // Get applicable policies
    const policies = await this.getApplicablePolicies(tenantId, userId, userRole, actionType);

    if (policies.length === 0) {
      // Default: require review for safety
      return {
        action: 'require_review',
        matchedPolicies: [],
        riskScore: 0.5,
        reasoning: 'No policies found, defaulting to require review',
      };
    }

    // Sort by priority (higher first)
    const sortedPolicies = [...policies].sort((a, b) => b.priority - a.priority);

    // Evaluate conditions
    for (const policy of sortedPolicies) {
      if (await this.evaluateConditions(policy.conditions, context)) {
        // Calculate risk score
        const riskScore = this.calculateRiskScore(context, policy.riskThreshold);

        return {
          action: policy.actions,
          matchedPolicies: [policy.id],
          riskScore,
          reasoning: `Matched policy: ${policy.policyName}`,
        };
      }
    }

    // No policy matched, default to require review
    return {
      action: 'require_review',
      matchedPolicies: [],
      riskScore: 0.5,
      reasoning: 'No policies matched conditions',
    };
  }

  /**
   * Get applicable policies
   */
  private async getApplicablePolicies(
    tenantId: TenantId,
    userId: UserId | null,
    userRole: string | null,
    actionType: string
  ): Promise<PolicyRule[]> {
    const result = await db.query<{
      id: string;
      tenant_id: string | null;
      policy_name: string;
      policy_type: string;
      scope: string;
      scope_id: string | null;
      conditions: unknown;
      actions: string;
      risk_threshold: number | null;
      priority: number;
      is_active: boolean;
    }>(
      `SELECT id, tenant_id, policy_name, policy_type, scope, scope_id,
              conditions, actions, risk_threshold, priority, is_active
       FROM autopilot_policies
       WHERE is_active = true
         AND (
           (scope = 'tenant' AND scope_id = $1)
           OR (scope = 'role' AND scope_id = $2)
           OR (scope = 'user' AND scope_id = $3)
           OR (scope = 'playbook' AND policy_type = $4)
         )
         AND (tenant_id IS NULL OR tenant_id = $1)
       ORDER BY priority DESC`,
      [tenantId, userRole, userId, actionType]
    );

    return result.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id as TenantId | null,
      policyName: row.policy_name,
      policyType: row.policy_type,
      scope: row.scope as PolicyScope,
      scopeId: row.scope_id,
      conditions: row.conditions as Record<string, unknown>,
      actions: row.actions as PolicyAction,
      riskThreshold: row.risk_threshold,
      priority: row.priority,
      isActive: row.is_active,
    }));
  }

  /**
   * Evaluate policy conditions
   */
  private async evaluateConditions(
    conditions: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<boolean> {
    // Simple condition evaluation (in production, use a proper expression evaluator)
    for (const [key, value] of Object.entries(conditions)) {
      const contextValue = context[key];
      
      if (typeof value === 'object' && value !== null) {
        const condition = value as { operator: string; value: unknown };
        switch (condition.operator) {
          case 'eq':
            if (contextValue !== condition.value) return false;
            break;
          case 'gt':
            if (typeof contextValue === 'number' && typeof condition.value === 'number') {
              if (contextValue <= condition.value) return false;
            }
            break;
          case 'lt':
            if (typeof contextValue === 'number' && typeof condition.value === 'number') {
              if (contextValue >= condition.value) return false;
            }
            break;
          case 'in':
            if (Array.isArray(condition.value) && !condition.value.includes(contextValue)) {
              return false;
            }
            break;
        }
      } else {
        if (contextValue !== value) return false;
      }
    }

    return true;
  }

  /**
   * Calculate risk score
   */
  private calculateRiskScore(context: Record<string, unknown>, threshold: number | null): number {
    // Simple risk calculation (in production, use ML model)
    let risk = 0.5; // Default medium risk

    if (context.amount && typeof context.amount === 'number') {
      if (context.amount > 10000) risk += 0.2;
      if (context.amount > 100000) risk += 0.3;
    }

    if (context.confidenceScore && typeof context.confidenceScore === 'number') {
      risk -= (1 - context.confidenceScore) * 0.3;
    }

    if (threshold !== null) {
      if (risk > threshold) risk = threshold;
    }

    return Math.max(0, Math.min(1, risk));
  }

  /**
   * Create policy
   */
  async createPolicy(
    tenantId: TenantId | null,
    policyName: string,
    policyType: string,
    scope: PolicyScope,
    scopeId: string | null,
    conditions: Record<string, unknown>,
    actions: PolicyAction,
    riskThreshold: number | null,
    priority: number,
    createdBy: UserId
  ): Promise<string> {
    const { randomUUID } = await import('crypto');
    const policyId = randomUUID();

    await db.query(
      `INSERT INTO autopilot_policies (
        id, tenant_id, policy_name, policy_type, scope, scope_id,
        conditions, actions, risk_threshold, priority, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
      [
        policyId,
        tenantId,
        policyName,
        policyType,
        scope,
        scopeId,
        JSON.stringify(conditions),
        actions,
        riskThreshold,
        priority,
        createdBy,
      ]
    );

    return policyId;
  }
}

export const policyEngine = new PolicyEngine();
