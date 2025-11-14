import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { postDoubleEntry, DoubleEntryTransaction } from './posting';

const logger = createLogger('ledger-service');

export interface Accrual {
  id: string;
  tenantId: TenantId;
  description: string;
  accountCode: string;
  amount: number;
  periodStart: Date;
  periodEnd: Date;
  status: 'pending' | 'posted' | 'reversed';
  createdBy: UserId;
}

export interface Prepayment {
  id: string;
  tenantId: TenantId;
  description: string;
  accountCode: string;
  amount: number;
  periodStart: Date;
  periodEnd: Date;
  status: 'pending' | 'posted' | 'amortized';
  createdBy: UserId;
}

/**
 * Create accrual entry
 */
export async function createAccrual(
  tenantId: TenantId,
  description: string,
  accountCode: string,
  amount: number,
  periodStart: Date,
  periodEnd: Date,
  createdBy: UserId
): Promise<string> {
  const accrualId = crypto.randomUUID();

  await db.query(
    `INSERT INTO accruals (
      id, tenant_id, description, account_code, amount, period_start, period_end, status, created_by, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, NOW())`,
    [accrualId, tenantId, description, accountCode, amount, periodStart, periodEnd, createdBy]
  );

  logger.info('Accrual created', { accrualId, tenantId });
  return accrualId;
}

/**
 * Post accrual to ledger
 */
export async function postAccrual(accrualId: string, tenantId: TenantId): Promise<void> {
  const accrual = await db.query<{
    id: string;
    description: string;
    account_code: string;
    amount: number;
    period_end: Date;
  }>(
    'SELECT id, description, account_code, amount, period_end FROM accruals WHERE id = $1 AND tenant_id = $2',
    [accrualId, tenantId]
  );

  if (accrual.rows.length === 0) {
    throw new Error('Accrual not found');
  }

  const acc = accrual.rows[0];

  // Post double-entry: Debit expense, Credit accruals liability
  await postDoubleEntry({
    tenantId,
    description: `Accrual: ${acc.description}`,
    transactionDate: acc.period_end,
    entries: [
      {
        entryType: 'debit',
        accountCode: acc.account_code,
        accountName: await getAccountName(tenantId, acc.account_code),
        amount: acc.amount,
      },
      {
        entryType: 'credit',
        accountCode: '2100', // Accruals
        accountName: 'Accruals',
        amount: acc.amount,
      },
    ],
    createdBy: 'system',
    metadata: { accrualId: acc.id },
  });

  await db.query(
    'UPDATE accruals SET status = $1 WHERE id = $2',
    ['posted', accrualId]
  );

  logger.info('Accrual posted', { accrualId, tenantId });
}

/**
 * Reverse accrual
 */
export async function reverseAccrual(accrualId: string, tenantId: TenantId): Promise<void> {
  const accrual = await db.query<{
    description: string;
    account_code: string;
    amount: number;
    period_end: Date;
  }>(
    'SELECT description, account_code, amount, period_end FROM accruals WHERE id = $1 AND tenant_id = $2',
    [accrualId, tenantId]
  );

  if (accrual.rows.length === 0) {
    throw new Error('Accrual not found');
  }

  const acc = accrual.rows[0];

  // Reverse: Credit expense, Debit accruals
  await postDoubleEntry({
    tenantId,
    description: `Accrual Reversal: ${acc.description}`,
    transactionDate: new Date(),
    entries: [
      {
        entryType: 'credit',
        accountCode: acc.account_code,
        accountName: await getAccountName(tenantId, acc.account_code),
        amount: acc.amount,
      },
      {
        entryType: 'debit',
        accountCode: '2100',
        accountName: 'Accruals',
        amount: acc.amount,
      },
    ],
    createdBy: 'system',
    metadata: { accrualId: acc.id, reversal: true },
  });

  await db.query(
    'UPDATE accruals SET status = $1 WHERE id = $2',
    ['reversed', accrualId]
  );

  logger.info('Accrual reversed', { accrualId, tenantId });
}

/**
 * Create prepayment
 */
export async function createPrepayment(
  tenantId: TenantId,
  description: string,
  accountCode: string,
  amount: number,
  periodStart: Date,
  periodEnd: Date,
  createdBy: UserId
): Promise<string> {
  const prepaymentId = crypto.randomUUID();

  await db.query(
    `INSERT INTO prepayments (
      id, tenant_id, description, account_code, amount, period_start, period_end, status, created_by, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, NOW())`,
    [prepaymentId, tenantId, description, accountCode, amount, periodStart, periodEnd, createdBy]
  );

  logger.info('Prepayment created', { prepaymentId, tenantId });
  return prepaymentId;
}

/**
 * Amortize prepayment (spread over periods)
 */
export async function amortizePrepayment(
  prepaymentId: string,
  tenantId: TenantId,
  periods: number
): Promise<void> {
  const prepayment = await db.query<{
    description: string;
    account_code: string;
    amount: number;
    period_start: Date;
    period_end: Date;
  }>(
    'SELECT description, account_code, amount, period_start, period_end FROM prepayments WHERE id = $1 AND tenant_id = $2',
    [prepaymentId, tenantId]
  );

  if (prepayment.rows.length === 0) {
    throw new Error('Prepayment not found');
  }

  const prep = prepayment.rows[0];
  const monthlyAmount = prep.amount / periods;

  // Create amortization entries
  for (let i = 0; i < periods; i++) {
    const amortDate = new Date(prep.period_start);
    amortDate.setMonth(amortDate.getMonth() + i);

    await postDoubleEntry({
      tenantId,
      description: `Prepayment Amortization: ${prep.description} (Period ${i + 1}/${periods})`,
      transactionDate: amortDate,
      entries: [
        {
          entryType: 'debit',
          accountCode: prep.account_code,
          accountName: await getAccountName(tenantId, prep.account_code),
          amount: monthlyAmount,
        },
        {
          entryType: 'credit',
          accountCode: '1200', // Prepayments
          accountName: 'Prepayments',
          amount: monthlyAmount,
        },
      ],
      createdBy: 'system',
      metadata: { prepaymentId: prep.id, period: i + 1, totalPeriods: periods },
    });
  }

  await db.query(
    'UPDATE prepayments SET status = $1 WHERE id = $2',
    ['amortized', prepaymentId]
  );

  logger.info('Prepayment amortized', { prepaymentId, tenantId, periods });
}

async function getAccountName(tenantId: TenantId, accountCode: string): Promise<string> {
  const result = await db.query<{ account_name: string }>(
    'SELECT account_name FROM chart_of_accounts WHERE tenant_id = $1 AND account_code = $2',
    [tenantId, accountCode]
  );

  return result.rows[0]?.account_name || accountCode;
}
