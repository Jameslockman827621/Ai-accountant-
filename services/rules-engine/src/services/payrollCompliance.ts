import { db } from '@ai-accountant/database';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('rules-engine-service');

export interface PayrollComplianceRequest {
  country: string;
  jurisdiction?: string;
  payPeriodEnd: string;
  payDate: string;
  payRunId?: string;
}

export interface PayrollComplianceFinding {
  ruleId: string;
  description: string;
  severity: 'info' | 'warning' | 'error';
  remediation: string;
}

export interface PayrollChecklistItem {
  title: string;
  required: boolean;
  status: 'pending' | 'complete' | 'blocked';
  detail?: string;
}

export interface PayrollComplianceResponse {
  runId?: string;
  jurisdiction: string;
  findings: PayrollComplianceFinding[];
  checklist: PayrollChecklistItem[];
}

export class PayrollComplianceService {
  async evaluateRun(
    tenantId: TenantId,
    payload: PayrollComplianceRequest
  ): Promise<PayrollComplianceResponse> {
    if (!payload.country) {
      throw new ValidationError('Country is required for payroll compliance evaluation');
    }

    const jurisdiction = payload.jurisdiction || payload.country;
    logger.info('Evaluating payroll compliance', { tenantId, jurisdiction, payRunId: payload.payRunId });

    const findings: PayrollComplianceFinding[] = [];
    const checklist = await this.buildChecklist(tenantId, jurisdiction, payload);

    // Check PAYE/withholding filings
    const filingDue = await this.checkUpcomingFiling(tenantId, jurisdiction, payload.payDate);
    if (filingDue) {
      findings.push({
        ruleId: 'withholding-filing',
        severity: 'warning',
        description: `Withholding submission due by ${filingDue.dueDate.toISOString().split('T')[0]}`,
        remediation: 'Queue RTI/withholding file with correct gross-to-net totals and employer references.',
      });
    }

    // Check pension/benefits remittance
    const pensionGaps = await this.checkPensionRemittance(tenantId, payload.payPeriodEnd);
    findings.push(...pensionGaps);

    // Check for local leave/holiday accrual rules
    if (jurisdiction.toLowerCase().startsWith('uk')) {
      findings.push({
        ruleId: 'uk-holiday-accrual',
        severity: 'info',
        description: 'Ensure holiday accrual at 5.6 weeks equivalent and pro-rata for part-time.',
        remediation: 'Sync leave balances to payroll journal and publish employee statements.',
      });
    }

    return { runId: payload.payRunId, jurisdiction, findings, checklist };
  }

  private async buildChecklist(
    tenantId: TenantId,
    jurisdiction: string,
    payload: PayrollComplianceRequest
  ): Promise<PayrollChecklistItem[]> {
    const statutoryNotices = await db.query<{ notice: string }>(
      `SELECT notice FROM compliance_notices
        WHERE tenant_id = $1 AND jurisdiction = $2 AND category = 'payroll'
        ORDER BY created_at DESC
        LIMIT 3`,
      [tenantId, jurisdiction]
    );

    return [
      {
        title: 'Reconcile gross-to-net and employer taxes',
        required: true,
        status: 'pending',
      },
      {
        title: 'Validate payment file (SEPA/ACH/BACS)',
        required: true,
        status: 'pending',
        detail: 'Check sort code/IBAN formats and duplicate payees.',
      },
      {
        title: 'Confirm statutory notices reviewed',
        required: false,
        status: statutoryNotices.rows.length ? 'complete' : 'pending',
        detail: statutoryNotices.rows.map(row => row.notice).join('; '),
      },
      {
        title: `Local tax pack ready for ${jurisdiction}`,
        required: true,
        status: 'pending',
        detail: `Pay date ${payload.payDate} / period ending ${payload.payPeriodEnd}`,
      },
    ];
  }

  private async checkUpcomingFiling(
    tenantId: TenantId,
    jurisdiction: string,
    payDate: string
  ): Promise<{ dueDate: Date } | null> {
    const result = await db.query<{ due_date: Date }>(
      `SELECT due_date FROM filing_calendar
        WHERE tenant_id = $1 AND jurisdiction = $2
          AND filing_type IN ('PAYE', 'withholding', 'rti')
          AND due_date >= $3
        ORDER BY due_date ASC
        LIMIT 1`,
      [tenantId, jurisdiction, new Date(payDate)]
    );

    if (!result.rows[0]) {
      return null;
    }

    return { dueDate: result.rows[0].due_date };
  }

  private async checkPensionRemittance(
    tenantId: TenantId,
    periodEnd: string
  ): Promise<PayrollComplianceFinding[]> {
    const findings: PayrollComplianceFinding[] = [];

    const contributions = await db.query<{ missing_amount: number }>(
      `SELECT SUM(expected_amount - remitted_amount) as missing_amount
         FROM payroll_benefit_contributions
        WHERE tenant_id = $1 AND period_end = $2
          AND (expected_amount - remitted_amount) > 0`,
      [tenantId, periodEnd]
    );

    const missing = contributions.rows[0]?.missing_amount || 0;
    if (missing > 0) {
      findings.push({
        ruleId: 'pension-remittance',
        severity: missing > 1000 ? 'error' : 'warning',
        description: `£${missing.toFixed(2)} in pension/benefit remittances outstanding`,
        remediation: 'Initiate remittance batch and attach payment references to journal entries.',
      });
    }

    return findings;
  }
}

export const payrollComplianceService = new PayrollComplianceService();
