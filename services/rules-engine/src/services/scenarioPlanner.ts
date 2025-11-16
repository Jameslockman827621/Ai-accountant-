import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { rulepackRegistryService } from './rulepackRegistry';

const logger = createLogger('scenario-planner');

export interface TaxScenario {
  id: string;
  tenantId: TenantId;
  scenarioName: string;
  scenarioDescription: string | null;
  scenarioType: 'forecast' | 'optimization' | 'what_if' | 'restructuring';
  inputParameters: Record<string, unknown>;
  adjustments: Record<string, unknown>;
  projectedLiabilities: Record<string, number>;
  savingsAmount: number | null;
  savingsPercentage: number | null;
  riskScore: number | null;
  metrics: Record<string, unknown>;
  aiCommentary: string | null;
  recommendations: Array<{
    title: string;
    description: string;
    impact: string;
    risk: 'low' | 'medium' | 'high';
  }>;
  status: 'draft' | 'running' | 'completed' | 'failed';
  executedAt: Date | null;
  executionTimeMs: number | null;
  createdAt: Date;
}

/**
 * Scenario Planner Service (Chunk 4)
 * Simulates tax scenarios and provides optimization recommendations
 */
export class ScenarioPlannerService {
  /**
   * Create and execute scenario
   */
  async executeScenario(
    tenantId: TenantId,
    scenarioName: string,
    scenarioType: TaxScenario['scenarioType'],
    inputParameters: Record<string, unknown>,
    adjustments: Record<string, unknown> = {},
    createdBy: UserId
  ): Promise<string> {
    const scenarioId = randomUUID();

    // Create scenario record
    await db.query(
      `INSERT INTO tax_scenarios (
        id, tenant_id, scenario_name, scenario_type, input_parameters,
        adjustments, status, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5::jsonb, $6::jsonb, 'running', $7, NOW(), NOW()
      )`,
      [
        scenarioId,
        tenantId,
        scenarioName,
        scenarioType,
        JSON.stringify(inputParameters),
        JSON.stringify(adjustments),
        createdBy,
      ]
    );

    // Execute scenario asynchronously
    this.runScenario(scenarioId, tenantId, scenarioType, inputParameters, adjustments).catch(
      error => {
        logger.error('Scenario execution failed', {
          scenarioId,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    );

    return scenarioId;
  }

  /**
   * Run scenario calculation
   */
  private async runScenario(
    scenarioId: string,
    tenantId: TenantId,
    scenarioType: TaxScenario['scenarioType'],
    inputParameters: Record<string, unknown>,
    adjustments: Record<string, unknown>
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Get jurisdictions from input
      const jurisdictions = (inputParameters.jurisdictions as string[]) || ['GB'];

      // Calculate projected liabilities for each jurisdiction
      const projectedLiabilities: Record<string, number> = {};
      let totalSavings = 0;
      let baselineTotal = 0;

      for (const jurisdiction of jurisdictions) {
        const rulepack = await rulepackRegistryService.getActiveRulepack(jurisdiction);
        if (!rulepack) {
          continue;
        }

        // Calculate baseline
        const baseline = this.calculateBaseline(inputParameters, jurisdiction);
        baselineTotal += baseline;

        // Calculate adjusted (with scenario adjustments)
        const adjusted = this.calculateAdjusted(inputParameters, adjustments, jurisdiction);
        projectedLiabilities[jurisdiction] = adjusted;

        const savings = baseline - adjusted;
        totalSavings += savings;
      }

      const savingsPercentage = baselineTotal > 0 ? (totalSavings / baselineTotal) * 100 : 0;
      const riskScore = this.calculateRiskScore(adjustments, projectedLiabilities);

      // Generate AI commentary
      const aiCommentary = this.generateCommentary(scenarioType, totalSavings, riskScore);

      // Generate recommendations
      const recommendations = this.generateRecommendations(scenarioType, adjustments, totalSavings);

      const executionTime = Date.now() - startTime;

      // Update scenario with results
      await db.query(
        `UPDATE tax_scenarios
         SET status = 'completed',
             projected_liabilities = $1::jsonb,
             savings_amount = $2,
             savings_percentage = $3,
             risk_score = $4,
             metrics = $5::jsonb,
             ai_commentary = $6,
             recommendations = $7::jsonb,
             executed_at = NOW(),
             execution_time_ms = $8,
             updated_at = NOW()
         WHERE id = $9`,
        [
          JSON.stringify(projectedLiabilities),
          totalSavings,
          savingsPercentage,
          riskScore,
          JSON.stringify({ baselineTotal, totalSavings }),
          aiCommentary,
          JSON.stringify(recommendations),
          executionTime,
          scenarioId,
        ]
      );

      logger.info('Scenario completed', { scenarioId, executionTime });
    } catch (error) {
      await db.query(
        `UPDATE tax_scenarios
         SET status = 'failed',
             updated_at = NOW()
         WHERE id = $1`,
        [scenarioId]
      );

      throw error;
    }
  }

  /**
   * Calculate baseline liability
   */
  private calculateBaseline(
    inputParameters: Record<string, unknown>,
    jurisdiction: string
  ): number {
    const revenue = (inputParameters.revenue as number) || 0;
    const expenses = (inputParameters.expenses as number) || 0;

    // Simple calculation (in production, would use actual tax rules)
    if (jurisdiction === 'GB') {
      return revenue * 0.20; // 20% VAT
    } else if (jurisdiction.startsWith('US')) {
      return (revenue - expenses) * 0.21; // 21% corporate tax
    }

    return revenue * 0.15; // Default
  }

  /**
   * Calculate adjusted liability with scenario changes
   */
  private calculateAdjusted(
    inputParameters: Record<string, unknown>,
    adjustments: Record<string, unknown>,
    jurisdiction: string
  ): number {
    const revenue = ((inputParameters.revenue as number) || 0) + ((adjustments.revenueDelta as number) || 0);
    const expenses = ((inputParameters.expenses as number) || 0) + ((adjustments.expenseDelta as number) || 0);

    // Apply same calculation as baseline
    if (jurisdiction === 'GB') {
      return revenue * 0.20;
    } else if (jurisdiction.startsWith('US')) {
      return (revenue - expenses) * 0.21;
    }

    return revenue * 0.15;
  }

  /**
   * Calculate risk score
   */
  private calculateRiskScore(
    adjustments: Record<string, unknown>,
    liabilities: Record<string, number>
  ): number {
    // Simple risk calculation (in production, would be more sophisticated)
    let risk = 0.3; // Base risk

    if (adjustments.revenueDelta && Math.abs(adjustments.revenueDelta as number) > 100000) {
      risk += 0.2;
    }

    if (Object.keys(liabilities).length > 3) {
      risk += 0.1; // Multi-jurisdiction complexity
    }

    return Math.min(risk, 1.0);
  }

  /**
   * Generate AI commentary
   */
  private generateCommentary(
    scenarioType: string,
    savings: number,
    riskScore: number
  ): string {
    if (scenarioType === 'optimization') {
      return `This scenario shows potential savings of £${savings.toLocaleString()}. Risk score: ${(riskScore * 100).toFixed(0)}%. Consider consulting with a tax advisor before implementing.`;
    } else if (scenarioType === 'forecast') {
      return `Based on current projections, estimated tax liability is £${Math.abs(savings).toLocaleString()}.`;
    }

    return 'Scenario analysis complete. Review recommendations below.';
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    scenarioType: string,
    adjustments: Record<string, unknown>,
    savings: number
  ): Array<{
    title: string;
    description: string;
    impact: string;
    risk: 'low' | 'medium' | 'high';
  }> {
    const recommendations: Array<{
      title: string;
      description: string;
      impact: string;
      risk: 'low' | 'medium' | 'high';
    }> = [];

    if (savings > 0) {
      recommendations.push({
        title: 'Potential Tax Savings Identified',
        description: `This scenario could result in savings of £${savings.toLocaleString()}.`,
        impact: 'high',
        risk: 'medium',
      });
    }

    if (adjustments.revenueDelta) {
      recommendations.push({
        title: 'Revenue Timing Optimization',
        description: 'Consider timing revenue recognition to optimize tax liability.',
        impact: 'medium',
        risk: 'low',
      });
    }

    return recommendations;
  }

  /**
   * Get scenario by ID
   */
  async getScenario(scenarioId: string): Promise<TaxScenario | null> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      scenario_name: string;
      scenario_description: string | null;
      scenario_type: string;
      input_parameters: unknown;
      adjustments: unknown;
      projected_liabilities: unknown;
      savings_amount: number | null;
      savings_percentage: number | null;
      risk_score: number | null;
      metrics: unknown;
      ai_commentary: string | null;
      recommendations: unknown;
      status: string;
      executed_at: Date | null;
      execution_time_ms: number | null;
      created_at: Date;
    }>(
      `SELECT * FROM tax_scenarios WHERE id = $1`,
      [scenarioId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      scenarioName: row.scenario_name,
      scenarioDescription: row.scenario_description,
      scenarioType: row.scenario_type as TaxScenario['scenarioType'],
      inputParameters: (row.input_parameters as Record<string, unknown>) || {},
      adjustments: (row.adjustments as Record<string, unknown>) || {},
      projectedLiabilities: (row.projected_liabilities as Record<string, number>) || {},
      savingsAmount: row.savings_amount,
      savingsPercentage: row.savings_percentage,
      riskScore: row.risk_score,
      metrics: (row.metrics as Record<string, unknown>) || {},
      aiCommentary: row.ai_commentary,
      recommendations: (row.recommendations as TaxScenario['recommendations']) || [],
      status: row.status as TaxScenario['status'],
      executedAt: row.executed_at,
      executionTimeMs: row.execution_time_ms,
      createdAt: row.created_at,
    };
  }

  /**
   * List scenarios for tenant
   */
  async listScenarios(tenantId: TenantId): Promise<TaxScenario[]> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      scenario_name: string;
      scenario_description: string | null;
      scenario_type: string;
      input_parameters: unknown;
      adjustments: unknown;
      projected_liabilities: unknown;
      savings_amount: number | null;
      savings_percentage: number | null;
      risk_score: number | null;
      metrics: unknown;
      ai_commentary: string | null;
      recommendations: unknown;
      status: string;
      executed_at: Date | null;
      execution_time_ms: number | null;
      created_at: Date;
    }>(
      `SELECT * FROM tax_scenarios
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId]
    );

    return result.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      scenarioName: row.scenario_name,
      scenarioDescription: row.scenario_description,
      scenarioType: row.scenario_type as TaxScenario['scenarioType'],
      inputParameters: (row.input_parameters as Record<string, unknown>) || {},
      adjustments: (row.adjustments as Record<string, unknown>) || {},
      projectedLiabilities: (row.projected_liabilities as Record<string, number>) || {},
      savingsAmount: row.savings_amount,
      savingsPercentage: row.savings_percentage,
      riskScore: row.risk_score,
      metrics: (row.metrics as Record<string, unknown>) || {},
      aiCommentary: row.ai_commentary,
      recommendations: (row.recommendations as TaxScenario['recommendations']) || [],
      status: row.status as TaxScenario['status'],
      executedAt: row.executed_at,
      executionTimeMs: row.execution_time_ms,
      createdAt: row.created_at,
    }));
  }
}

export const scenarioPlannerService = new ScenarioPlannerService();
