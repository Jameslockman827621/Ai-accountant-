import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import { complianceCalendarService } from '../../../compliance/src/services/complianceCalendar';
import { filingLifecycleService } from '../../../filing/src/services/filingLifecycle';
import { rulepackManager } from '../../../rules-engine/src/services/rulepackDSL';

const logger = createLogger('assistant-compliance-mode');

export interface ComplianceContext {
  tenantId: TenantId;
  userId: UserId;
  upcomingObligations: Array<{
    filingType: string;
    jurisdiction: string;
    dueDate: string;
    readinessScore: number;
  }>;
  activeRulepacks: Array<{
    jurisdiction: string;
    filingType: string;
    version: string;
  }>;
  recentFilings: Array<{
    filingType: string;
    status: string;
    periodEnd: string;
  }>;
}

export class ComplianceModeService {
  /**
   * Get compliance context for assistant
   */
  async getComplianceContext(tenantId: TenantId, userId: UserId): Promise<ComplianceContext> {
    // Get upcoming obligations
    const deadlines = await complianceCalendarService.getUpcomingDeadlines(tenantId, 90);

    // Get active rulepacks
    const rulepacksResult = await db.query<{
      jurisdiction: string;
      filing_type: string;
      version: string;
    }>(
      `SELECT DISTINCT jurisdiction, filing_type, version
       FROM rulepack_catalog
       WHERE status = 'active'
       ORDER BY jurisdiction, filing_type`,
      []
    );

    // Get recent filings
    const filingsResult = await db.query<{
      filing_type: string;
      status: string;
      period_end: string;
    }>(
      `SELECT filing_type, status, period_end
       FROM filing_ledger
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [tenantId]
    );

    return {
      tenantId,
      userId,
      upcomingObligations: deadlines.map(d => ({
        filingType: d.filingType || 'unknown',
        jurisdiction: d.jurisdiction,
        dueDate: d.dueDate,
        readinessScore: d.readinessScore,
      })),
      activeRulepacks: rulepacksResult.rows,
      recentFilings: filingsResult.rows,
    };
  }

  /**
   * Generate compliance prompt template
   */
  generateCompliancePrompt(context: ComplianceContext, userQuery: string): string {
    const obligationsText = context.upcomingObligations
      .map(
        ob =>
          `- ${ob.filingType} (${ob.jurisdiction}): Due ${ob.dueDate}, Readiness: ${ob.readinessScore}%`
      )
      .join('\n');

    const rulepacksText = context.activeRulepacks
      .map(rp => `- ${rp.jurisdiction} ${rp.filingType} (v${rp.version})`)
      .join('\n');

    return `You are an AI compliance assistant helping with tax and regulatory filings.

CONTEXT:
- Tenant ID: ${context.tenantId}
- Upcoming Obligations:
${obligationsText || '  None in next 90 days'}

- Active Rulepacks:
${rulepacksText || '  None configured'}

- Recent Filings:
${context.recentFilings.map(f => `  - ${f.filingType}: ${f.status} (Period ending ${f.period_end})`).join('\n') || '  None'}

USER QUERY: ${userQuery}

INSTRUCTIONS:
1. When answering compliance questions, cite specific rulepack IDs and filing types
2. For filing preparation requests (e.g., "Prepare Q2 VAT return"), check readiness scores first
3. Explain calculations by referencing rulepack rules
4. Warn about upcoming deadlines and readiness issues
5. Provide actionable recommendations

RESPONSE:`;
  }

  /**
   * Handle filing preparation command
   */
  async handleFilingPreparationCommand(
    tenantId: TenantId,
    userId: UserId,
    command: string
  ): Promise<{
    success: boolean;
    message: string;
    filingId?: string;
    readinessCheck?: {
      score: number;
      issues: string[];
    };
  }> {
    // Parse command (e.g., "Prepare Q2 VAT return", "Prepare UK VAT for Jan-Mar 2024")
    const filingTypeMatch = command.match(/(?:prepare|create|generate)\s+(.+?)(?:\s+return|\s+filing|$)/i);
    if (!filingTypeMatch) {
      return {
        success: false,
        message: 'Could not parse filing type from command. Please specify the filing type (e.g., "Prepare Q2 VAT return").',
      };
    }

    const filingType = filingTypeMatch[1].trim();

    // Get tenant jurisdiction
    const tenantResult = await db.query<{ jurisdiction: string }>(
      `SELECT jurisdiction FROM intent_profiles WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      return {
        success: false,
        message: 'Tenant jurisdiction not found. Please complete onboarding first.',
      };
    }

    const jurisdiction = tenantResult.rows[0].jurisdiction;

    // Determine period (simplified - in production would parse dates from command)
    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
    const periodStart = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().split('T')[0];

    // Check readiness
    const readiness = await complianceCalendarService.calculateReadiness(tenantId, {
      filingType,
      periodStart,
      periodEnd,
    });

    if (readiness.overall < 50) {
      return {
        success: false,
        message: `Readiness score is too low (${readiness.overall}%). Please address the following issues before preparing the filing:\n${readiness.details.missingData.map(d => `- ${d}`).join('\n')}`,
        readinessCheck: {
          score: readiness.overall,
          issues: [
            ...readiness.details.missingData,
            ...(readiness.details.unmatchedTransactions > 0
              ? [`${readiness.details.unmatchedTransactions} unmatched transactions`]
              : []),
            ...readiness.details.unhealthyConnectors,
          ],
        },
      };
    }

    // Create filing draft
    try {
      const draft = await filingLifecycleService.createDraft(
        tenantId,
        {
          filingType,
          jurisdiction,
          periodStart,
          periodEnd,
          dueDate: new Date(periodEnd).toISOString().split('T')[0],
        },
        userId
      );

      return {
        success: true,
        message: `Filing draft created successfully. Readiness: ${readiness.overall}%. You can review and submit it from the Filings page.`,
        filingId: draft.filingId,
        readinessCheck: {
          score: readiness.overall,
          issues: [],
        },
      };
    } catch (error) {
      logger.error('Filing preparation failed', error instanceof Error ? error : new Error(String(error)));
      return {
        success: false,
        message: 'Failed to create filing draft. Please try again or contact support.',
      };
    }
  }

  /**
   * Explain filing calculation
   */
  async explainFilingCalculation(
    filingId: string,
    fieldName?: string
  ): Promise<{
    explanations: Array<{
      field: string;
      value: unknown;
      calculation: string;
      rules: string[];
    }>;
  }> {
    const result = await db.query<{
      field_name: string | null;
      value: number | null;
      calculation_steps: unknown;
      rule_applied: unknown;
    }>(
      `SELECT field_name, value, calculation_steps, rule_applied
       FROM filing_explanations
       WHERE filing_id = $1
         ${fieldName ? 'AND field_name = $2' : ''}
       ORDER BY field_name`,
      fieldName ? [filingId, fieldName] : [filingId]
    );

    return {
      explanations: result.rows.map(row => ({
        field: row.field_name || 'unknown',
        value: row.value,
        calculation: JSON.stringify(row.calculation_steps),
        rules: (row.rule_applied as { rules?: string[] })?.rules || [],
      })),
    };
  }
}

export const complianceModeService = new ComplianceModeService();
