import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { randomUUID } from 'crypto';
import { rulepackManager } from '../../../rules-engine/src/services/rulepackDSL';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { authorityAdapterRegistry } from './authorityAdapters';
import { initiateAuthorityPayment } from './paymentOrchestration';

const logger = createLogger('filing-lifecycle');

export interface FilingObligation {
  filingType: string;
  jurisdiction: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  rulepackId?: string;
}

export interface FilingDraft {
  filingId: string;
  filingType: string;
  jurisdiction: string;
  periodStart: string;
  periodEnd: string;
  filingData: Record<string, unknown>;
  calculatedValues: Record<string, unknown>;
  sourceTransactions: string[];
  adjustments: Record<string, unknown>;
  explanations: Array<{
    field: string;
    value: unknown;
    calculation: string;
    rules: string[];
  }>;
}

export interface FilingSubmission {
  filingId: string;
  submissionReference: string;
  submittedAt: string;
  submittedBy: string;
}

export class FilingLifecycleService {
  /**
   * Discover filing obligations for tenant
   */
  async discoverObligations(
    tenantId: TenantId,
    startDate: string,
    endDate: string
  ): Promise<FilingObligation[]> {
    // Get tenant jurisdiction and filing types from intent profile
    const tenantResult = await db.query<{
      jurisdiction: string;
      filing_types: string[];
    }>(
      `SELECT ip.jurisdiction, ip.filing_types
       FROM intent_profiles ip
       WHERE ip.tenant_id = $1
       LIMIT 1`,
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      return [];
    }

    const tenant = tenantResult.rows[0];
    const obligations: FilingObligation[] = [];

    // Generate obligations based on filing types and periods
    for (const filingType of tenant.filing_types || []) {
      const periods = this.generatePeriods(tenant.jurisdiction, filingType, startDate, endDate);
      
      for (const period of periods) {
        obligations.push({
          filingType,
          jurisdiction: tenant.jurisdiction,
          periodStart: period.start,
          periodEnd: period.end,
          dueDate: period.dueDate,
        });
      }
    }

    return obligations;
  }

  /**
   * Create filing draft
   */
  async createDraft(
    tenantId: TenantId,
    obligation: FilingObligation,
    createdBy: UserId
  ): Promise<FilingDraft> {
    // Get source data for period
    const sourceData = await this.hydrateSourceData(tenantId, obligation);
    
    // Evaluate rulepack
    const evaluationResult = await rulepackManager.evaluateForFiling(
      obligation.jurisdiction,
      obligation.filingType,
      {
        tenantId,
        periodStart: obligation.periodStart,
        periodEnd: obligation.periodEnd,
        data: sourceData,
      }
    );

    // Create filing record
    const filingId = randomUUID();
    
    await db.query(
      `INSERT INTO filing_ledger (
        id, tenant_id, filing_type, jurisdiction, period_start, period_end,
        status, filing_data, calculated_values, source_transactions,
        rulepack_version, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12)`,
      [
        filingId,
        tenantId,
        obligation.filingType,
        obligation.jurisdiction,
        obligation.periodStart,
        obligation.periodEnd,
        'draft',
        JSON.stringify(sourceData),
        JSON.stringify(evaluationResult.calculatedValues),
        JSON.stringify(evaluationResult.appliedRules.map(r => r.ruleId)),
        'latest', // Would get actual version from rulepack
        createdBy,
      ]
    );

    // Store explanations
    for (const explanation of evaluationResult.explanations) {
      await db.query(
        `INSERT INTO filing_explanations (
          filing_id, section, field_name, value, calculation_steps,
          rule_applied, source_transactions
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
        [
          filingId,
          'calculation',
          explanation.field,
          explanation.value,
          JSON.stringify([{ step: explanation.calculation }]),
          JSON.stringify({ rules: explanation.rules }),
          JSON.stringify([]),
        ]
      );
    }

    return {
      filingId,
      filingType: obligation.filingType,
      jurisdiction: obligation.jurisdiction,
      periodStart: obligation.periodStart,
      periodEnd: obligation.periodEnd,
      filingData: sourceData,
      calculatedValues: evaluationResult.calculatedValues,
      sourceTransactions: evaluationResult.appliedRules.map(r => r.ruleId),
      adjustments: {},
      explanations: evaluationResult.explanations,
    };
  }

  /**
   * Submit filing
   */
  async submitFiling(
    filingId: string,
    tenantId: TenantId,
    submittedBy: UserId,
    adapter: string // 'hmrc_vat', 'hmrc_paye', etc.
  ): Promise<FilingSubmission> {
    // Get filing
    const filingResult = await db.query<{
      filing_type: string;
      jurisdiction: string;
      filing_data: unknown;
      calculated_values: unknown;
    }>(
      `SELECT filing_type, jurisdiction, filing_data, calculated_values
       FROM filing_ledger
       WHERE id = $1 AND tenant_id = $2 AND status IN ('approved', 'pending_approval')`,
      [filingId, tenantId]
    );

    if (filingResult.rows.length === 0) {
      throw new Error('Filing not found or not approved');
    }

    const filing = filingResult.rows[0];

    const submission = await authorityAdapterRegistry.submit({
      filingId,
      tenantId,
      filingType: filing.filing_type,
      jurisdiction: filing.jurisdiction,
      payload: filing.filing_data || {},
      adapterHint: adapter,
    });

    if (submission.requiresPayment && submission.amountDue && submission.amountDue > 0) {
      await initiateAuthorityPayment({
        filingId,
        tenantId,
        authority: submission.authority,
        amount: submission.amountDue,
        currency: submission.currency || 'GBP',
      });
    }

    // Update filing status
    await db.query(
      `UPDATE filing_ledger
       SET status = 'submitted',
           submitted_at = NOW(),
            submitted_by = $1,
            submission_reference = $2
        WHERE id = $3`,
      [submittedBy, submission.submissionReference, filingId]
    );

    return {
      filingId,
      submissionReference: submission.submissionReference,
      submittedAt: new Date().toISOString(),
      submittedBy,
    };
  }

  /**
   * Store acknowledgement
   */
  async storeAcknowledgement(
    filingId: string,
    acknowledgementReference: string,
    acknowledgementData: Record<string, unknown>
  ): Promise<void> {
    await db.query(
      `UPDATE filing_ledger
       SET status = 'acknowledged',
           acknowledgement_reference = $1,
           acknowledgement_data = $2::jsonb
       WHERE id = $3`,
      [acknowledgementReference, JSON.stringify(acknowledgementData), filingId]
    );
  }

  private generatePeriods(
    jurisdiction: string,
    filingType: string,
    startDate: string,
    endDate: string
  ): Array<{ start: string; end: string; dueDate: string }> {
    const periods: Array<{ start: string; end: string; dueDate: string }> = [];
    
    // Determine period frequency based on filing type
    let frequency: 'monthly' | 'quarterly' | 'annually' = 'quarterly';
    
    if (filingType.includes('monthly')) frequency = 'monthly';
    if (filingType.includes('annual')) frequency = 'annually';
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    let current = new Date(start);
    
    while (current <= end) {
      const periodEnd = new Date(current);
      
      if (frequency === 'monthly') {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        periodEnd.setDate(0); // Last day of month
      } else if (frequency === 'quarterly') {
        periodEnd.setMonth(periodEnd.getMonth() + 3);
        periodEnd.setDate(0);
      } else {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        periodEnd.setMonth(11, 31);
      }
      
      if (periodEnd > end) periodEnd.setTime(end.getTime());
      
      // Calculate due date (typically 1 month after period end for VAT, varies by jurisdiction)
      const dueDate = new Date(periodEnd);
      dueDate.setMonth(dueDate.getMonth() + 1);
      dueDate.setDate(7); // 7th of following month (UK VAT standard)
      
      periods.push({
        start: current.toISOString().split('T')[0],
        end: periodEnd.toISOString().split('T')[0],
        dueDate: dueDate.toISOString().split('T')[0],
      });
      
      current = new Date(periodEnd);
      current.setDate(current.getDate() + 1);
    }
    
    return periods;
  }

  private async hydrateSourceData(
    tenantId: TenantId,
    obligation: FilingObligation
  ): Promise<Record<string, unknown>> {
    // Get ledger entries for period
    const ledgerResult = await db.query<{
      account_code: string;
      debit: number;
      credit: number;
      transaction_date: string;
    }>(
      `SELECT account_code, debit, credit, transaction_date
       FROM ledger_entries
       WHERE tenant_id = $1
         AND transaction_date >= $2
         AND transaction_date <= $3
       ORDER BY transaction_date`,
      [tenantId, obligation.periodStart, obligation.periodEnd]
    );

    // Get documents for period
    const documentsResult = await db.query<{
      document_type: string;
      total_amount: number;
      tax_amount: number;
    }>(
      `SELECT document_type, total_amount, tax_amount
       FROM documents
       WHERE tenant_id = $1
         AND document_date >= $2
         AND document_date <= $3`,
      [tenantId, obligation.periodStart, obligation.periodEnd]
    );

    // Aggregate data based on filing type
    const data: Record<string, unknown> = {
      periodStart: obligation.periodStart,
      periodEnd: obligation.periodEnd,
      ledgerEntries: ledgerResult.rows,
      documents: documentsResult.rows,
    };

    // Calculate totals
    let totalSales = 0;
    let totalPurchases = 0;
    let totalVAT = 0;

    for (const doc of documentsResult.rows) {
      if (doc.document_type === 'invoice' || doc.document_type === 'sales_invoice') {
        totalSales += doc.total_amount || 0;
        totalVAT += doc.tax_amount || 0;
      } else if (doc.document_type === 'receipt' || doc.document_type === 'purchase') {
        totalPurchases += doc.total_amount || 0;
        totalVAT -= doc.tax_amount || 0;
      }
    }

    data.totalSales = totalSales;
    data.totalPurchases = totalPurchases;
    data.totalVAT = totalVAT;
    data.netVAT = totalVAT;

    return data;
  }

}

export const filingLifecycleService = new FilingLifecycleService();
