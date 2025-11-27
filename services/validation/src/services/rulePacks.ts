import { ValidationRulePack } from '@ai-accountant/shared-types';

export type ExecutableValidationRulePack = ValidationRulePack & {
  evaluate: (payload: Record<string, any>) => RuleEvaluation[];
};

export interface RuleEvaluation {
  ruleId: string;
  status: 'pass' | 'warning' | 'fail';
  message: string;
  metadata?: Record<string, unknown>;
  dataPath?: string;
}

const now = new Date();

const bankingRulePack: ExecutableValidationRulePack = {
  id: 'banking-core-v1',
  domain: 'banking',
  version: '1.0.0',
  description: 'Deterministic controls for reconciled balances, stale transactions, and duplicates',
  checksum: 'banking-core-v1',
  createdAt: now,
  updatedAt: now,
  rules: [
    {
      id: 'banking-reconciled-balance',
      domain: 'banking',
      name: 'Transactions must be reconciled',
      description: 'All transactions should be linked to ledger entries once posted',
      condition: 'transaction.reconciled === true',
      severity: 'warning',
      deterministic: true,
      tags: ['reconciliation', 'ledger'],
    },
    {
      id: 'banking-stale-transactions',
      domain: 'banking',
      name: 'Transactions reviewed within 14 days',
      description: 'Bank transactions should not remain unreviewed beyond 14 days',
      condition: 'transaction.ageInDays <= 14',
      severity: 'warning',
      deterministic: true,
      tags: ['sla', 'operations'],
    },
    {
      id: 'banking-duplicates',
      domain: 'banking',
      name: 'Duplicate detection',
      description: 'Prevent duplicate amounts on the same day without supporting memo changes',
      condition: 'transaction.duplicateGroupSize === 1',
      severity: 'critical',
      deterministic: true,
      tags: ['quality'],
    },
  ],
  evaluate: payload => {
    const transactions = (payload.banking?.transactions as any[]) || [];
    return transactions.flatMap(tx => {
      const evaluations: RuleEvaluation[] = [];
      const duplicateGroup = tx.duplicateGroupSize ?? 1;
      const reconciled = Boolean(tx.reconciled);
      const ageInDays = Number(tx.ageInDays ?? 0);

      evaluations.push({
        ruleId: 'banking-reconciled-balance',
        status: reconciled ? 'pass' : 'fail',
        message: reconciled
          ? 'Transaction reconciled with ledger'
          : 'Unreconciled transaction requires review',
        dataPath: `banking.transactions.${tx.id}`,
      });

      evaluations.push({
        ruleId: 'banking-stale-transactions',
        status: ageInDays <= 14 ? 'pass' : 'warning',
        message: ageInDays <= 14
          ? 'Reviewed within SLA'
          : `Transaction pending review for ${ageInDays} days`,
        dataPath: `banking.transactions.${tx.id}`,
        metadata: { ageInDays },
      });

      evaluations.push({
        ruleId: 'banking-duplicates',
        status: duplicateGroup > 1 ? 'fail' : 'pass',
        message:
          duplicateGroup > 1
            ? `Potential duplicate detected across ${duplicateGroup} transactions`
            : 'No duplicate detected',
        dataPath: `banking.transactions.${tx.id}`,
        metadata: { duplicateGroup },
      });

      return evaluations;
    });
  },
};

const payrollRulePack: ExecutableValidationRulePack = {
  id: 'payroll-core-v1',
  domain: 'payroll',
  version: '1.0.0',
  description: 'Net pay, tax, and contributions deterministic validation',
  checksum: 'payroll-core-v1',
  createdAt: now,
  updatedAt: now,
  rules: [
    {
      id: 'payroll-net-equals-gross-less-deductions',
      domain: 'payroll',
      name: 'Net pay alignment',
      description: 'Net pay must equal gross minus tax and contributions',
      condition: 'gross - taxWithheld - contributions === net',
      severity: 'critical',
      deterministic: true,
      tags: ['math', 'payroll'],
    },
    {
      id: 'payroll-period-approved',
      domain: 'payroll',
      name: 'Pay period approval',
      description: 'Payroll run must be approved before payout',
      condition: 'run.approved === true',
      severity: 'warning',
      deterministic: true,
      tags: ['approval'],
    },
  ],
  evaluate: payload => {
    const runs = (payload.payroll?.runs as any[]) || [];
    return runs.flatMap(run => {
      const evaluations: RuleEvaluation[] = [];
      const expectedNet = Number(run.gross ?? 0) - Number(run.taxWithheld ?? 0) - Number(run.contributions ?? 0);
      const net = Number(run.net ?? 0);
      const netAligned = Math.abs(net - expectedNet) < 0.01;

      evaluations.push({
        ruleId: 'payroll-net-equals-gross-less-deductions',
        status: netAligned ? 'pass' : 'fail',
        message: netAligned
          ? 'Net pay reconciles to gross minus deductions'
          : `Net pay mismatch: expected ${expectedNet.toFixed(2)} but found ${net.toFixed(2)}`,
        dataPath: `payroll.runs.${run.id}`,
        metadata: { expectedNet, net },
      });

      const approved = Boolean(run.approved);
      evaluations.push({
        ruleId: 'payroll-period-approved',
        status: approved ? 'pass' : 'warning',
        message: approved ? 'Payroll run approved' : 'Payroll run awaiting approval',
        dataPath: `payroll.runs.${run.id}`,
      });

      return evaluations;
    });
  },
};

const apArRulePack: ExecutableValidationRulePack = {
  id: 'ap-ar-core-v1',
  domain: 'ap_ar',
  version: '1.0.0',
  description: 'Accounts payable and receivable controls for due dates and dispute flags',
  checksum: 'ap-ar-core-v1',
  createdAt: now,
  updatedAt: now,
  rules: [
    {
      id: 'ap-receipts-approved',
      domain: 'ap_ar',
      name: 'AP approvals present',
      description: 'Vendor bills must have at least one approver before payment',
      condition: 'invoice.approvers.length > 0',
      severity: 'warning',
      deterministic: true,
      tags: ['ap', 'approval'],
    },
    {
      id: 'ap-ar-overdue',
      domain: 'ap_ar',
      name: 'Overdue invoices flagged',
      description: 'Invoices that are overdue should be flagged for escalation',
      condition: 'invoice.daysOverdue <= 0',
      severity: 'critical',
      deterministic: true,
      tags: ['aging'],
    },
    {
      id: 'ar-disputes-documented',
      domain: 'ap_ar',
      name: 'Receivables dispute documentation',
      description: 'Disputed receivables require a documented dispute reason',
      condition: "!invoice.disputed || invoice.disputeReason !== ''",
      severity: 'warning',
      deterministic: true,
      tags: ['ar', 'collections'],
    },
  ],
  evaluate: payload => {
    const invoices = (payload.ap_ar?.invoices as any[]) || [];
    return invoices.flatMap(invoice => {
      const evaluations: RuleEvaluation[] = [];
      const approvers = Array.isArray(invoice.approvers) ? invoice.approvers : [];
      const daysOverdue = Number(invoice.daysOverdue ?? 0);
      const disputed = Boolean(invoice.disputed);
      const disputeReason = (invoice.disputeReason as string | undefined) ?? '';

      evaluations.push({
        ruleId: 'ap-receipts-approved',
        status: approvers.length > 0 ? 'pass' : 'warning',
        message:
          approvers.length > 0
            ? 'Approval captured'
            : 'No approver recorded for vendor bill',
        dataPath: `ap_ar.invoices.${invoice.id}`,
      });

      evaluations.push({
        ruleId: 'ap-ar-overdue',
        status: daysOverdue > 0 ? 'fail' : 'pass',
        message:
          daysOverdue > 0
            ? `Invoice overdue by ${daysOverdue} days`
            : 'Invoice within terms',
        dataPath: `ap_ar.invoices.${invoice.id}`,
        metadata: { daysOverdue },
      });

      evaluations.push({
        ruleId: 'ar-disputes-documented',
        status: !disputed || disputeReason.trim().length > 0 ? 'pass' : 'warning',
        message: !disputed
          ? 'No dispute on receivable'
          : disputeReason.trim().length > 0
            ? 'Dispute documented'
            : 'Dispute missing documentation',
        dataPath: `ap_ar.invoices.${invoice.id}`,
        metadata: { disputed, disputeReason },
      });

      return evaluations;
    });
  },
};

const taxRulePack: ExecutableValidationRulePack = {
  id: 'tax-deterministic-v1',
  domain: 'tax',
  version: '1.0.0',
  description: 'Tax validations for filing completeness and regression coverage',
  checksum: 'tax-deterministic-v1',
  createdAt: now,
  updatedAt: now,
  rules: [
    {
      id: 'tax-filing-signed',
      domain: 'tax',
      name: 'Filing signed off',
      description: 'Tax filing must include reviewer approval and signature metadata',
      condition: 'filing.signedOffBy !== undefined',
      severity: 'critical',
      deterministic: true,
      tags: ['governance'],
    },
    {
      id: 'tax-regression-cases',
      domain: 'tax',
      name: 'Regression coverage present',
      description: 'Regression cases must exist for tax calculations to guard against drift',
      condition: 'regressions.length > 0',
      severity: 'warning',
      deterministic: true,
      tags: ['regression'],
    },
  ],
  evaluate: payload => {
    const filings = (payload.tax?.filings as any[]) || [];
    const regressionCases = (payload.tax?.regressionCases as any[]) || [];
    return [
      ...filings.flatMap(filing => {
        const signed = Boolean(filing.signedOffBy);
        return [
          {
            ruleId: 'tax-filing-signed',
            status: signed ? 'pass' : 'fail',
            message: signed ? 'Filing signed off' : 'Missing sign-off on filing',
            dataPath: `tax.filings.${filing.id}`,
          },
        ];
      }),
      {
        ruleId: 'tax-regression-cases',
        status: regressionCases.length > 0 ? 'pass' : 'warning',
        message:
          regressionCases.length > 0
            ? `Regression library contains ${regressionCases.length} case(s)`
            : 'No regression cases available for tax calculations',
        dataPath: 'tax.regressionCases',
      },
    ];
  },
};

export const executableRulePacks: ExecutableValidationRulePack[] = [
  bankingRulePack,
  payrollRulePack,
  apArRulePack,
  taxRulePack,
];

export function getRulePack(domain: string): ExecutableValidationRulePack | undefined {
  return executableRulePacks.find(pack => pack.domain === domain);
}
