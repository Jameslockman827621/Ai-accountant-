import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('validation-service');

export interface Anomaly {
  type: 'amount' | 'frequency' | 'pattern' | 'date';
  severity: 'low' | 'medium' | 'high';
  description: string;
  entityId?: string;
  entityType?: string;
  details?: Record<string, unknown>;
}

export async function detectAnomalies(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<Anomaly[]> {
  logger.info('Detecting anomalies', { tenantId, periodStart, periodEnd });

  const anomalies: Anomaly[] = [];

  // Get historical averages for comparison
  const historicalResult = await db.query<{
    avg_amount: number;
    stddev_amount: number;
    count: number;
  }>(
    `SELECT 
       AVG(ABS(amount)) as avg_amount,
       STDDEV(ABS(amount)) as stddev_amount,
       COUNT(*) as count
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date < $2
       AND transaction_date >= $2 - INTERVAL '12 months'`,
    [tenantId, periodStart]
  );

  const avgAmount = typeof historicalResult.rows[0]?.avg_amount === 'number'
    ? historicalResult.rows[0].avg_amount
    : parseFloat(String(historicalResult.rows[0]?.avg_amount || '0'));
  const stddevAmount = typeof historicalResult.rows[0]?.stddev_amount === 'number'
    ? historicalResult.rows[0].stddev_amount
    : parseFloat(String(historicalResult.rows[0]?.stddev_amount || '0'));

  // Check for unusually large transactions
  const largeTransactions = await db.query<{
    id: string;
    amount: number;
    description: string;
    transaction_date: Date;
  }>(
    `SELECT id, amount, description, transaction_date
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
       AND ABS(amount) > $4`,
    [tenantId, periodStart, periodEnd, avgAmount + (3 * stddevAmount)]
  );

  for (const transaction of largeTransactions.rows) {
    const amount = Math.abs(transaction.amount);
    const zScore = stddevAmount > 0 ? (amount - avgAmount) / stddevAmount : 0;
    
    anomalies.push({
      type: 'amount',
      severity: zScore > 5 ? 'high' : zScore > 3 ? 'medium' : 'low',
      description: `Unusually large transaction: £${amount.toFixed(2)}`,
      entityId: transaction.id,
      entityType: 'ledger_entry',
      details: {
        amount,
        average: avgAmount,
        zScore: zScore.toFixed(2),
        description: transaction.description,
      },
    });
  }

  // Check for duplicate transactions
  const duplicates = await db.query<{
    amount: number;
    description: string;
    count: number;
    dates: string;
  }>(
    `SELECT 
       amount,
       description,
       COUNT(*) as count,
       STRING_AGG(transaction_date::text, ', ') as dates
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
     GROUP BY amount, description
     HAVING COUNT(*) > 1`,
    [tenantId, periodStart, periodEnd]
  );

  for (const dup of duplicates.rows) {
    const count = typeof dup.count === 'number' ? dup.count : parseInt(String(dup.count || '0'), 10);
    if (count > 2) {
      anomalies.push({
        type: 'pattern',
        severity: 'medium',
        description: `Potential duplicate transaction: ${dup.description} (£${Math.abs(dup.amount).toFixed(2)}) appears ${count} times`,
        details: {
          amount: dup.amount,
          description: dup.description,
          count,
          dates: dup.dates,
        },
      });
    }
  }

  // Check for transactions on weekends/holidays
  const weekendTransactions = await db.query<{
    id: string;
    amount: number;
    transaction_date: Date;
  }>(
    `SELECT id, amount, transaction_date
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
       AND EXTRACT(DOW FROM transaction_date) IN (0, 6)`,
    [tenantId, periodStart, periodEnd]
  );

  if (weekendTransactions.rows.length > 0) {
    anomalies.push({
      type: 'date',
      severity: 'low',
      description: `${weekendTransactions.rows.length} transactions recorded on weekends`,
      details: {
        count: weekendTransactions.rows.length,
      },
    });
  }

  // Check for negative amounts in revenue accounts
  const negativeRevenue = await db.query<{
    id: string;
    amount: number;
    account_code: string;
  }>(
    `SELECT id, amount, account_code
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
       AND account_code LIKE '4%'
       AND entry_type = 'debit'
       AND amount > 0`,
    [tenantId, periodStart, periodEnd]
  );

  if (negativeRevenue.rows.length > 0) {
    anomalies.push({
      type: 'pattern',
      severity: 'medium',
      description: `${negativeRevenue.rows.length} debit entries in revenue accounts (unusual)`,
      details: {
        count: negativeRevenue.rows.length,
      },
    });
  }

  return anomalies;
}
