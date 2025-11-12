import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { parse } from 'csv-parse/sync';

const logger = createLogger('bank-feed-service');

export interface CSVTransaction {
  date: string;
  description: string;
  amount: number;
  balance?: number;
  reference?: string;
}

export async function importCSVTransactions(
  tenantId: TenantId,
  accountId: string,
  csvContent: string
): Promise<number> {
  logger.info('Importing CSV transactions', { tenantId, accountId });

  try {
    // Parse CSV
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string>>;

    let imported = 0;

    for (const record of records) {
      // Try to map common CSV formats
      const date = record.date || record.Date || record['Transaction Date'] || record['Date'];
      const description = record.description || record.Description || record['Transaction Description'] || record['Description'];
      const amountStr = record.amount || record.Amount || record['Transaction Amount'] || record['Amount'];
      const reference = record.reference || record.Reference || record['Transaction Reference'] || '';

      if (!date || !description || !amountStr) {
        logger.warn('Skipping incomplete CSV row', { record });
        continue;
      }

      const amount = parseFloat(amountStr.replace(/[£,]/g, ''));

      if (isNaN(amount)) {
        logger.warn('Skipping row with invalid amount', { record });
        continue;
      }

      // Check for duplicates
      const existing = await db.query<{ count: string | number }>(
        `SELECT COUNT(*) as count
         FROM bank_transactions
         WHERE tenant_id = $1
           AND account_id = $2
           AND date = $3
           AND ABS(amount - $4) < 0.01
           AND description = $5`,
        [tenantId, accountId, new Date(date), amount, description]
      );

      const count = typeof existing.rows[0]?.count === 'number'
        ? existing.rows[0].count
        : parseInt(String(existing.rows[0]?.count || '0'), 10);

      if (count > 0) {
        logger.debug('Skipping duplicate transaction', { date, amount, description });
        continue;
      }

      // Insert transaction
      await db.query(
        `INSERT INTO bank_transactions (
          id, tenant_id, account_id, transaction_id, date, amount, currency, description, created_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, 'GBP', $6, NOW()
        )`,
        [
          tenantId,
          accountId,
          reference || crypto.randomUUID(),
          new Date(date),
          amount,
          description,
        ]
      );

      imported++;
    }

    logger.info('CSV import completed', { tenantId, accountId, imported, total: records.length });
    return imported;
  } catch (error) {
    logger.error('CSV import failed', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to import CSV: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
