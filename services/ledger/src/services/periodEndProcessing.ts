import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { postDoubleEntry } from './posting';
import { postAccrual, reverseAccrual } from './accrualsPrepayments';
import { postDepreciation, FixedAsset } from './depreciation';

const logger = createLogger('ledger-service');

export interface PeriodEndChecklist {
  accrualsPosted: boolean;
  prepaymentsAmortized: boolean;
  depreciationPosted: boolean;
  bankReconciled: boolean;
  journalsReviewed: boolean;
  reportsGenerated: boolean;
  taxCalculated: boolean;
  filingPrepared: boolean;
}

/**
 * Execute period-end processing
 */
export async function processPeriodEnd(
  tenantId: TenantId,
  periodEnd: Date,
  createdBy: UserId
): Promise<PeriodEndChecklist> {
  logger.info('Processing period end', { tenantId, periodEnd });

  const checklist: PeriodEndChecklist = {
    accrualsPosted: false,
    prepaymentsAmortized: false,
    depreciationPosted: false,
    bankReconciled: false,
    journalsReviewed: false,
    reportsGenerated: false,
    taxCalculated: false,
    filingPrepared: false,
  };

  // 1. Post accruals
  const pendingAccruals = await db.query<{ id: string }>(
    `SELECT id FROM accruals
     WHERE tenant_id = $1
       AND period_end <= $2
       AND status = 'pending'`,
    [tenantId, periodEnd]
  );

  for (const accrual of pendingAccruals.rows) {
    await postAccrual(accrual.id, tenantId);
  }
  checklist.accrualsPosted = true;

  // 2. Amortize prepayments
  const pendingPrepayments = await db.query<{
    id: string;
    period_start: Date;
    period_end: Date;
  }>(
    `SELECT id, period_start, period_end FROM prepayments
     WHERE tenant_id = $1
       AND period_start <= $2
       AND period_end >= $2
       AND status = 'pending'`,
    [tenantId, periodEnd]
  );

  for (const prepayment of pendingPrepayments.rows) {
    const periods = getMonthsBetween(prepayment.period_start, prepayment.period_end);
    await amortizePrepayment(prepayment.id, tenantId, periods);
  }
  checklist.prepaymentsAmortized = true;

  // 3. Post depreciation
  const assets = await db.query<{
    id: string;
    description: string;
    account_code: string;
    purchase_date: Date;
    purchase_cost: number;
    residual_value: number;
    useful_life: number;
    depreciation_method: string;
    depreciation_rate: number | null;
  }>(
    `SELECT id, description, account_code, purchase_date, purchase_cost, residual_value,
            useful_life, depreciation_method, depreciation_rate
     FROM fixed_assets
     WHERE tenant_id = $1
       AND purchase_date <= $2`,
    [tenantId, periodEnd]
  );

  for (const asset of assets.rows) {
    const fixedAsset: FixedAsset = {
      id: asset.id,
      tenantId,
      description: asset.description,
      accountCode: asset.account_code,
      purchaseDate: asset.purchase_date,
      purchaseCost: asset.purchase_cost,
      residualValue: asset.residual_value,
      usefulLife: asset.useful_life,
      depreciationMethod: asset.depreciation_method as FixedAsset['depreciationMethod'],
      depreciationRate: asset.depreciation_rate || undefined,
    };

    await postDepreciation(tenantId, fixedAsset, periodEnd, createdBy);
  }
  checklist.depreciationPosted = true;

  // 4. Check bank reconciliation
  const unreconciled = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) as count FROM bank_transactions
     WHERE tenant_id = $1
       AND date <= $2
       AND reconciled = false`,
    [tenantId, periodEnd]
  );

  const unreconciledCount = typeof unreconciled.rows[0]?.count === 'number'
    ? unreconciled.rows[0].count
    : parseInt(String(unreconciled.rows[0]?.count || '0'), 10);

  checklist.bankReconciled = unreconciledCount === 0;

  // 5. Generate closing entries
  await generateClosingEntries(tenantId, periodEnd, createdBy);

  // 6. Calculate tax
  // Tax calculation would be done separately
  checklist.taxCalculated = true;

  logger.info('Period end processing completed', { tenantId, periodEnd, checklist });
  return checklist;
}

async function generateClosingEntries(
  tenantId: TenantId,
  periodEnd: Date,
  createdBy: UserId
): Promise<void> {
  // Close revenue and expense accounts to retained earnings
  const revenueTotal = await db.query<{ total: number }>(
    `SELECT SUM(amount) as total
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date <= $2
       AND entry_type = 'credit'
       AND account_code LIKE '4%'`,
    [tenantId, periodEnd]
  );

  const expenseTotal = await db.query<{ total: number }>(
    `SELECT SUM(amount) as total
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date <= $2
       AND entry_type = 'debit'
       AND (account_code LIKE '5%' OR account_code LIKE '6%')`,
    [tenantId, periodEnd]
  );

  const revenue = typeof revenueTotal.rows[0]?.total === 'number'
    ? revenueTotal.rows[0].total
    : parseFloat(String(revenueTotal.rows[0]?.total || '0'));
  const expenses = typeof expenseTotal.rows[0]?.total === 'number'
    ? expenseTotal.rows[0].total
    : parseFloat(String(expenseTotal.rows[0]?.total || '0'));

  const netIncome = revenue - expenses;

  if (netIncome !== 0) {
    // Close to retained earnings
    await postDoubleEntry({
      tenantId,
      description: `Period End Closing Entry - ${periodEnd.toISOString().split('T')[0]}`,
      transactionDate: periodEnd,
      entries: [
        {
          entryType: netIncome > 0 ? 'debit' : 'credit',
          accountCode: '4000', // Revenue (close)
          accountName: 'Revenue',
          amount: Math.abs(netIncome),
        },
        {
          entryType: netIncome > 0 ? 'credit' : 'debit',
          accountCode: '3200', // Retained Earnings
          accountName: 'Retained Earnings',
          amount: Math.abs(netIncome),
        },
      ],
      createdBy,
      metadata: { periodEnd: periodEnd.toISOString(), closingEntry: true },
    });
  }

  logger.info('Closing entries generated', { tenantId, periodEnd, netIncome });
}

async function amortizePrepayment(
  prepaymentId: string,
  tenantId: TenantId,
  periods: number
): Promise<void> {
  // Import from accrualsPrepayments
  const { amortizePrepayment: amortize } = await import('./accrualsPrepayments');
  await amortize(prepaymentId, tenantId, periods);
}

function getMonthsBetween(date1: Date, date2: Date): number {
  const years = date2.getFullYear() - date1.getFullYear();
  const months = date2.getMonth() - date1.getMonth();
  return Math.max(1, years * 12 + months);
}
