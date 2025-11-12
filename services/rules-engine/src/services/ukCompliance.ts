import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import { getEntityTaxProfile } from './ukTaxEntities';
import { calculateFilingDeadlines } from './ukFilingDeadlines';

const logger = createLogger('rules-engine-service');

export interface ComplianceIssue {
  severity: 'error' | 'warning' | 'info';
  category: string;
  code: string;
  title: string;
  description: string;
  recommendation: string;
  deadline?: Date;
  penalty?: {
    amount: number;
    description: string;
  };
}

export interface ComplianceReport {
  tenantId: TenantId;
  asOfDate: Date;
  overallStatus: 'compliant' | 'at_risk' | 'non_compliant';
  issues: ComplianceIssue[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
    totalPenalties: number;
  };
  recommendations: string[];
}

export async function performComplianceCheck(
  tenantId: TenantId,
  asOfDate: Date = new Date()
): Promise<ComplianceReport> {
  const issues: ComplianceIssue[] = [];
  const recommendations: string[] = [];

  // Check VAT registration
  await checkVATRegistration(tenantId, asOfDate, issues, recommendations);

  // Check filing deadlines
  await checkFilingDeadlines(tenantId, asOfDate, issues, recommendations);

  // Check PAYE compliance
  await checkPAYECompliance(tenantId, asOfDate, issues, recommendations);

  // Check Corporation Tax compliance
  await checkCorporationTaxCompliance(tenantId, asOfDate, issues, recommendations);

  // Check record keeping
  await checkRecordKeeping(tenantId, asOfDate, issues, recommendations);

  // Check tax code compliance
  await checkTaxCodeCompliance(tenantId, asOfDate, issues, recommendations);

  // Check expense compliance
  await checkExpenseCompliance(tenantId, asOfDate, issues, recommendations);

  // Check VAT compliance
  await checkVATCompliance(tenantId, asOfDate, issues, recommendations);

  // Determine overall status
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const totalPenalties = issues.reduce((sum, i) => sum + (i.penalty?.amount || 0), 0);

  const overallStatus = errors > 0 ? 'non_compliant' : 
    warnings > 0 ? 'at_risk' : 'compliant';

  return {
    tenantId,
    asOfDate,
    overallStatus,
    issues,
    summary: {
      errors,
      warnings,
      info: issues.filter(i => i.severity === 'info').length,
      totalPenalties,
    },
    recommendations,
  };
}

async function checkVATRegistration(
  tenantId: TenantId,
  asOfDate: Date,
  issues: ComplianceIssue[],
  recommendations: string[]
): Promise<void> {
  const profile = await getEntityTaxProfile(tenantId);

  // Check if VAT registered
  const vatRegistered = await db.query<{ vat_number: string | null }>(
    'SELECT vat_number FROM tenants WHERE id = $1',
    [tenantId]
  );

  const isRegistered = !!vatRegistered.rows[0]?.vat_number;

  // Calculate rolling 12-month turnover
  const turnoverResult = await db.query<{ turnover: string | number }>(
    `SELECT COALESCE(SUM(amount), 0) as turnover
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'credit'
       AND account_code LIKE '4%'
       AND transaction_date >= $2
       AND transaction_date <= $3`,
    [
      tenantId,
      new Date(asOfDate.getFullYear(), asOfDate.getMonth() - 12, asOfDate.getDate()),
      asOfDate,
    ]
  );

  const turnover = typeof turnoverResult.rows[0]?.turnover === 'number'
    ? turnoverResult.rows[0].turnover
    : parseFloat(String(turnoverResult.rows[0]?.turnover || '0'));

  if (turnover >= profile.vat.registrationThreshold && !isRegistered) {
    issues.push({
      severity: 'error',
      category: 'vat',
      code: 'VAT001',
      title: 'VAT Registration Required',
      description: `Turnover of £${turnover.toLocaleString()} exceeds VAT registration threshold of £${profile.vat.registrationThreshold.toLocaleString()}`,
      recommendation: 'Register for VAT immediately. You may be liable for penalties for late registration.',
      penalty: {
        amount: 100,
        description: 'Late registration penalty',
      },
    });
    recommendations.push('Register for VAT with HMRC immediately');
  }

  if (turnover < profile.vat.deregistrationThreshold && isRegistered) {
    issues.push({
      severity: 'info',
      category: 'vat',
      code: 'VAT002',
      title: 'VAT Deregistration Possible',
      description: `Turnover below deregistration threshold. You may be able to deregister for VAT.`,
      recommendation: 'Consider deregistering for VAT if turnover remains below threshold.',
    });
  }
}

async function checkFilingDeadlines(
  tenantId: TenantId,
  asOfDate: Date,
  issues: ComplianceIssue[],
  recommendations: string[]
): Promise<void> {
  const deadlines = await calculateFilingDeadlines(tenantId, asOfDate);

  for (const deadline of deadlines.overdue) {
    issues.push({
      severity: 'error',
      category: 'filing',
      code: `FILING${deadline.type.toUpperCase()}`,
      title: `Overdue ${deadline.description}`,
      description: `Filing deadline was ${deadline.dueDate.toLocaleDateString()}. ${deadline.daysUntilDue} days overdue.`,
      recommendation: 'File immediately to minimize penalties.',
      deadline: deadline.dueDate,
      penalty: deadline.penalty,
    });
    recommendations.push(`File ${deadline.description} immediately`);
  }

  for (const deadline of deadlines.upcoming) {
    if (deadline.daysUntilDue <= 7) {
      issues.push({
        severity: 'warning',
        category: 'filing',
        code: `FILING${deadline.type.toUpperCase()}_UPCOMING`,
        title: `Upcoming ${deadline.description}`,
        description: `Filing due in ${deadline.daysUntilDue} days (${deadline.dueDate.toLocaleDateString()})`,
        recommendation: 'Prepare and file before deadline to avoid penalties.',
        deadline: deadline.dueDate,
      });
      recommendations.push(`Prepare ${deadline.description} for filing`);
    }
  }
}

async function checkPAYECompliance(
  tenantId: TenantId,
  asOfDate: Date,
  issues: ComplianceIssue[],
  recommendations: string[]
): Promise<void> {
  // Check for employees without PAYE setup
  const employeesResult = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) as count
     FROM users
     WHERE tenant_id = $1 AND role = 'client' AND is_active = true`,
    [tenantId]
  );

  const employeeCount = typeof employeesResult.rows[0]?.count === 'number'
    ? employeesResult.rows[0].count
    : parseInt(String(employeesResult.rows[0]?.count || '0'), 10);

  // Check PAYE payments
  const payePaymentsResult = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) as count
     FROM ledger_entries
     WHERE tenant_id = $1
       AND account_code LIKE '52%'
       AND transaction_date >= $2`,
    [tenantId, new Date(asOfDate.getFullYear(), asOfDate.getMonth() - 1, 1)]
  );

  const payePayments = typeof payePaymentsResult.rows[0]?.count === 'number'
    ? payePaymentsResult.rows[0].count
    : parseInt(String(payePaymentsResult.rows[0]?.count || '0'), 10);

  if (employeeCount > 0 && payePayments === 0) {
    issues.push({
      severity: 'warning',
      category: 'paye',
      code: 'PAYE001',
      title: 'No PAYE Payments Recorded',
      description: 'Employees exist but no PAYE payments recorded in recent period.',
      recommendation: 'Ensure PAYE is set up correctly and payments are being processed.',
    });
    recommendations.push('Review PAYE setup and ensure payments are being processed');
  }
}

async function checkCorporationTaxCompliance(
  tenantId: TenantId,
  asOfDate: Date,
  issues: ComplianceIssue[],
  recommendations: string[]
): Promise<void> {
  const profile = await getEntityTaxProfile(tenantId);

  if (!profile.corporationTax.applicable) {
    return;
  }

  // Check for Corporation Tax returns
  const ctReturnsResult = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) as count
     FROM filings
     WHERE tenant_id = $1
       AND filing_type = 'corporation_tax'
       AND status IN ('submitted', 'accepted')`,
    [tenantId]
  );

  const returnsCount = typeof ctReturnsResult.rows[0]?.count === 'number'
    ? ctReturnsResult.rows[0].count
    : parseInt(String(ctReturnsResult.rows[0]?.count || '0'), 10);

  // Check company year end
  const yearEndResult = await db.query<{ year_end: Date | null }>(
    'SELECT year_end FROM tenants WHERE id = $1',
    [tenantId]
  );

  const yearEnd = yearEndResult.rows[0]?.year_end;
  if (yearEnd) {
    const monthsSinceYearEnd = (asOfDate.getTime() - yearEnd.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (monthsSinceYearEnd > 9 && returnsCount === 0) {
      issues.push({
        severity: 'error',
        category: 'corporation_tax',
        code: 'CT001',
        title: 'Corporation Tax Return Overdue',
        description: `Corporation Tax return due 9 months after year end (${yearEnd.toLocaleDateString()})`,
        recommendation: 'File Corporation Tax return immediately.',
        penalty: {
          amount: 100,
          description: 'Late filing penalty',
        },
      });
      recommendations.push('File Corporation Tax return immediately');
    }
  }
}

async function checkRecordKeeping(
  tenantId: TenantId,
  asOfDate: Date,
  issues: ComplianceIssue[],
  recommendations: string[]
): Promise<void> {
  // Check for missing documents
  const documentsResult = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) as count
     FROM documents
     WHERE tenant_id = $1
       AND status = 'error'`,
    [tenantId]
  );

  const errorDocuments = typeof documentsResult.rows[0]?.count === 'number'
    ? documentsResult.rows[0].count
    : parseInt(String(documentsResult.rows[0]?.count || '0'), 10);

  if (errorDocuments > 0) {
    issues.push({
      severity: 'warning',
      category: 'record_keeping',
      code: 'REC001',
      title: 'Documents with Processing Errors',
      description: `${errorDocuments} document(s) failed to process. This may affect record keeping compliance.`,
      recommendation: 'Review and fix document processing errors to maintain accurate records.',
    });
    recommendations.push('Review and fix document processing errors');
  }

  // Check for unreconciled transactions
  const unreconciledResult = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) as count
     FROM ledger_entries
     WHERE tenant_id = $1
       AND reconciled = false
       AND transaction_date < $2`,
    [tenantId, new Date(asOfDate.getFullYear(), asOfDate.getMonth() - 3, 1)]
  );

  const unreconciled = typeof unreconciledResult.rows[0]?.count === 'number'
    ? unreconciledResult.rows[0].count
    : parseInt(String(unreconciledResult.rows[0]?.count || '0'), 10);

  if (unreconciled > 10) {
    issues.push({
      severity: 'warning',
      category: 'record_keeping',
      code: 'REC002',
      title: 'Unreconciled Transactions',
      description: `${unreconciled} transactions older than 3 months are unreconciled.`,
      recommendation: 'Reconcile transactions regularly to maintain accurate records.',
    });
    recommendations.push('Reconcile outstanding transactions');
  }
}

async function checkTaxCodeCompliance(
  tenantId: TenantId,
  asOfDate: Date,
  issues: ComplianceIssue[],
  recommendations: string[]
): Promise<void> {
  // Check for transactions with missing or invalid tax codes
  const invalidTaxResult = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) as count
     FROM ledger_entries
     WHERE tenant_id = $1
       AND tax_amount IS NOT NULL
       AND (tax_rate IS NULL OR tax_rate < 0 OR tax_rate > 1)`,
    [tenantId]
  );

  const invalidTax = typeof invalidTaxResult.rows[0]?.count === 'number'
    ? invalidTaxResult.rows[0].count
    : parseInt(String(invalidTaxResult.rows[0]?.count || '0'), 10);

  if (invalidTax > 0) {
    issues.push({
      severity: 'warning',
      category: 'tax_codes',
      code: 'TAX001',
      title: 'Invalid Tax Rates',
      description: `${invalidTax} transactions have invalid tax rates.`,
      recommendation: 'Review and correct tax rates to ensure accurate tax calculations.',
    });
    recommendations.push('Review and correct tax rates on transactions');
  }
}

async function checkExpenseCompliance(
  tenantId: TenantId,
  asOfDate: Date,
  issues: ComplianceIssue[],
  recommendations: string[]
): Promise<void> {
  // Check for unusually large expenses
  const largeExpensesResult = await db.query<{
    count: string | number;
    avg: string | number;
  }>(
    `SELECT COUNT(*) as count, AVG(amount) as avg
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'debit'
       AND account_code LIKE '5%'
       AND transaction_date >= $2`,
    [tenantId, new Date(asOfDate.getFullYear() - 1, 0, 1)]
  );

  const avgExpense = typeof largeExpensesResult.rows[0]?.avg === 'number'
    ? largeExpensesResult.rows[0].avg
    : parseFloat(String(largeExpensesResult.rows[0]?.avg || '0'));

  const largeExpenses = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) as count
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'debit'
       AND account_code LIKE '5%'
       AND amount > $2
       AND transaction_date >= $3`,
    [tenantId, avgExpense * 10, new Date(asOfDate.getFullYear() - 1, 0, 1)]
  );

  const largeCount = typeof largeExpensesResult.rows[0]?.count === 'number'
    ? largeExpensesResult.rows[0].count
    : parseInt(String(largeExpensesResult.rows[0]?.count || '0'), 10);

  if (largeCount > 0) {
    issues.push({
      severity: 'info',
      category: 'expenses',
      code: 'EXP001',
      title: 'Unusually Large Expenses',
      description: `${largeCount} expense(s) significantly larger than average. Ensure these are legitimate business expenses.`,
      recommendation: 'Review large expenses to ensure they are fully deductible and properly documented.',
    });
    recommendations.push('Review large expenses for deductibility');
  }
}

async function checkVATCompliance(
  tenantId: TenantId,
  asOfDate: Date,
  issues: ComplianceIssue[],
  recommendations: string[]
): Promise<void> {
  const profile = await getEntityTaxProfile(tenantId);

  if (!profile.vat.registrationThreshold) {
    return;
  }

  // Check for VAT returns
  const vatReturnsResult = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) as count
     FROM filings
     WHERE tenant_id = $1
       AND filing_type = 'vat'
       AND status IN ('submitted', 'accepted')
       AND period_end >= $2`,
    [tenantId, new Date(asOfDate.getFullYear(), asOfDate.getMonth() - 3, 1)]
  );

  const returnsCount = typeof vatReturnsResult.rows[0]?.count === 'number'
    ? vatReturnsResult.rows[0].count
    : parseInt(String(vatReturnsResult.rows[0]?.count || '0'), 10);

  // Should have at least 1 return in last 3 months if VAT registered
  const vatRegistered = await db.query<{ vat_number: string | null }>(
    'SELECT vat_number FROM tenants WHERE id = $1',
    [tenantId]
  );

  if (vatRegistered.rows[0]?.vat_number && returnsCount === 0) {
    issues.push({
      severity: 'warning',
      category: 'vat',
      code: 'VAT003',
      title: 'Missing VAT Returns',
      description: 'VAT registered but no returns filed in recent period.',
      recommendation: 'Ensure VAT returns are filed on time.',
    });
    recommendations.push('File outstanding VAT returns');
  }
}
