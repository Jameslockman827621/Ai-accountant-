import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('validation-service');

export interface Anomaly {
  id: string;
  type: 'amount' | 'frequency' | 'pattern' | 'outlier' | 'duplicate';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  itemId: string;
  itemType: 'document' | 'ledger_entry' | 'bank_transaction';
  amount?: number;
  date: Date;
  details: Record<string, unknown>;
  suggestedAction?: string;
}

export interface AnomalyDetectionResult {
  tenantId: TenantId;
  periodStart: Date;
  periodEnd: Date;
  totalAnomalies: number;
  anomalies: Anomaly[];
  summary: {
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}

/**
 * ML-based anomaly detection for transactions
 * Detects unusual patterns, amounts, frequencies, and outliers
 */
export async function detectAnomaliesML(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<AnomalyDetectionResult> {
  logger.info('Starting ML-based anomaly detection', { tenantId, periodStart, periodEnd });

  const anomalies: Anomaly[] = [];

  // Get historical data for baseline
  const baselineResult = await db.query<{
    avg_amount: number;
    stddev_amount: number;
    avg_count: number;
  }>(
    `SELECT 
       AVG(amount) as avg_amount,
       STDDEV(amount) as stddev_amount,
       COUNT(*)::float / EXTRACT(EPOCH FROM ($3::date - $2::date)) * 86400 as avg_count
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 - INTERVAL '90 days' AND $2
       AND transaction_date < $2`,
    [tenantId, periodStart, periodEnd]
  );

  const baseline = baselineResult.rows[0] || {
    avg_amount: 0,
    stddev_amount: 0,
    avg_count: 0,
  };

  const avgAmount = parseFloat(String(baseline.avg_amount || 0));
  const stddevAmount = parseFloat(String(baseline.stddev_amount || 0));
  const threshold = avgAmount + (3 * stddevAmount); // 3-sigma rule

  // Detect amount anomalies (outliers)
  const outlierResult = await db.query<{
    id: string;
    amount: number;
    transaction_date: Date;
    description: string;
  }>(
    `SELECT id, amount, transaction_date, description
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
       AND ABS(amount - $4) > $5 * 3`,
    [tenantId, periodStart, periodEnd, avgAmount, stddevAmount]
  );

  for (const row of outlierResult.rows) {
    const amount = parseFloat(String(row.amount));
    const zScore = stddevAmount > 0 ? Math.abs((amount - avgAmount) / stddevAmount) : 0;
    
    let severity: Anomaly['severity'] = 'low';
    if (zScore > 5) severity = 'critical';
    else if (zScore > 4) severity = 'high';
    else if (zScore > 3) severity = 'medium';

    anomalies.push({
      id: `anomaly_${row.id}`,
      type: 'outlier',
      severity,
      description: `Unusually large transaction: £${amount.toLocaleString()} (${zScore.toFixed(1)} standard deviations from mean)`,
      itemId: row.id,
      itemType: 'ledger_entry',
      amount,
      date: row.transaction_date,
      details: {
        zScore,
        mean: avgAmount,
        stddev: stddevAmount,
      },
      suggestedAction: zScore > 4 ? 'Review transaction for accuracy' : 'Verify transaction details',
    });
  }

  // Detect frequency anomalies (unusual transaction frequency)
  const frequencyResult = await db.query<{
    date: Date;
    count: number;
    total_amount: number;
  }>(
    `SELECT 
       transaction_date::date as date,
       COUNT(*) as count,
       SUM(amount) as total_amount
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
     GROUP BY transaction_date::date
     HAVING COUNT(*) > $4 * 2 OR SUM(amount) > $5 * 2`,
    [tenantId, periodStart, periodEnd, baseline.avg_count || 1, avgAmount]
  );

  for (const row of frequencyResult.rows) {
    const count = parseInt(String(row.count || 0), 10);
    const totalAmount = parseFloat(String(row.total_amount || 0));
    const expectedCount = parseFloat(String(baseline.avg_count || 1));

    anomalies.push({
      id: `freq_${row.date.toISOString()}`,
      type: 'frequency',
      severity: count > expectedCount * 3 ? 'high' : 'medium',
      description: `Unusual transaction frequency: ${count} transactions on ${row.date.toISOString().split('T')[0]} (expected ~${expectedCount.toFixed(1)})`,
      itemId: row.date.toISOString(),
      itemType: 'ledger_entry',
      amount: totalAmount,
      date: row.date,
      details: {
        count,
        expectedCount,
        ratio: count / (expectedCount || 1),
      },
      suggestedAction: 'Review transactions for duplicates or errors',
    });
  }

  // Detect pattern anomalies (round numbers, suspicious patterns)
  const patternResult = await db.query<{
    id: string;
    amount: number;
    transaction_date: Date;
    description: string;
  }>(
    `SELECT id, amount, transaction_date, description
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
       AND (
         amount::numeric % 1000 = 0 AND amount >= 10000
         OR amount::numeric % 100 = 0 AND amount >= 1000
       )`,
    [tenantId, periodStart, periodEnd]
  );

  for (const row of patternResult.rows) {
    const amount = parseFloat(String(row.amount));
    const isRound = amount % 1000 === 0;

    anomalies.push({
      id: `pattern_${row.id}`,
      type: 'pattern',
      severity: isRound && amount >= 10000 ? 'medium' : 'low',
      description: `Round number transaction: £${amount.toLocaleString()}`,
      itemId: row.id,
      itemType: 'ledger_entry',
      amount,
      date: row.transaction_date,
      details: {
        isRound,
        pattern: 'round_number',
      },
      suggestedAction: 'Verify transaction is legitimate',
    });
  }

  // Detect duplicate-like transactions
  const duplicateResult = await db.query<{
    id: string;
    amount: number;
    transaction_date: Date;
    description: string;
    count: number;
  }>(
    `SELECT 
       le1.id,
       le1.amount,
       le1.transaction_date,
       le1.description,
       COUNT(*) as count
     FROM ledger_entries le1
     JOIN ledger_entries le2 ON 
       le1.tenant_id = le2.tenant_id
       AND ABS(le1.amount - le2.amount) < 0.01
       AND ABS(EXTRACT(EPOCH FROM (le1.transaction_date - le2.transaction_date))) < 86400
       AND le1.id != le2.id
     WHERE le1.tenant_id = $1
       AND le1.transaction_date BETWEEN $2 AND $3
     GROUP BY le1.id, le1.amount, le1.transaction_date, le1.description
     HAVING COUNT(*) >= 1`,
    [tenantId, periodStart, periodEnd]
  );

  for (const row of duplicateResult.rows) {
    anomalies.push({
      id: `dup_${row.id}`,
      type: 'duplicate',
      severity: 'medium',
      description: `Potential duplicate transaction: £${parseFloat(String(row.amount)).toLocaleString()} on ${row.transaction_date.toISOString().split('T')[0]}`,
      itemId: row.id,
      itemType: 'ledger_entry',
      amount: parseFloat(String(row.amount)),
      date: row.transaction_date,
      details: {
        similarCount: parseInt(String(row.count || 0), 10),
      },
      suggestedAction: 'Review for duplicate entries',
    });
  }

  // Summary
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  for (const anomaly of anomalies) {
    byType[anomaly.type] = (byType[anomaly.type] || 0) + 1;
    bySeverity[anomaly.severity] = (bySeverity[anomaly.severity] || 0) + 1;
  }

  return {
    tenantId,
    periodStart,
    periodEnd,
    totalAnomalies: anomalies.length,
    anomalies,
    summary: {
      byType,
      bySeverity,
    },
  };
}
