import crypto from 'crypto';
import { db } from '@ai-accountant/database';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { parse } from 'csv-parse/sync';

const logger = createLogger('bank-feed-service');
const MAX_ROWS = Number(process.env.BANK_FEED_CSV_MAX_ROWS || 2000);

interface ParsedRow {
  date: Date;
  description: string;
  amount: number;
  reference: string | null;
}

function normaliseRow(record: Record<string, string>): ParsedRow {
  const rawDate =
    record.date ||
    record.Date ||
    record['Transaction Date'] ||
    record['Date'] ||
    record['Posting Date'];
  const rawDescription =
    record.description ||
    record.Description ||
    record['Transaction Description'] ||
    record['Description'] ||
    record['Details'];
  const rawAmount =
    record.amount ||
    record.Amount ||
    record['Transaction Amount'] ||
    record['Amount'] ||
    record['Debit'] ||
    record['Credit'];

  if (!rawDate || !rawDescription || !rawAmount) {
    throw new ValidationError('CSV row is missing required fields (date, description, amount)');
  }

  const parsedDate = new Date(rawDate);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new ValidationError(`Invalid date format: ${rawDate}`);
  }

  const normalisedAmount = parseFloat(
    rawAmount.replace(/[£,\s]/g, '')
  );
  if (!Number.isFinite(normalisedAmount)) {
    throw new ValidationError(`Invalid amount: ${rawAmount}`);
  }

  return {
    date: parsedDate,
    description: rawDescription.slice(0, 512),
    amount: normalisedAmount,
    reference:
      record.reference ||
      record.Reference ||
      record['Transaction Reference'] ||
      record['Cheque Number'] ||
      null,
  };
}

export async function importCSVTransactions(
  tenantId: TenantId,
  accountId: string,
  csvContent: string
): Promise<number> {
  logger.info('Importing CSV transactions', { tenantId, accountId });

  if (!csvContent || csvContent.length > 5_000_000) {
    throw new ValidationError('CSV payload is too large');
  }

  let records: Array<Record<string, string>>;
  try {
    records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string>>;
  } catch (error) {
    logger.error('CSV parsing failed', error instanceof Error ? error : new Error(String(error)));
    throw new ValidationError('Unable to parse CSV file');
  }

  if (records.length === 0) {
    throw new ValidationError('CSV file does not contain any rows');
  }

  if (records.length > MAX_ROWS) {
    throw new ValidationError(`CSV file exceeds maximum of ${MAX_ROWS} rows`);
  }

  const parsedRows: ParsedRow[] = [];
  const errors: string[] = [];

  records.forEach((record, index) => {
    try {
      parsedRows.push(normaliseRow(record));
    } catch (error) {
      errors.push(`Row ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  if (errors.length > 0) {
    throw new ValidationError(`CSV validation failed: ${errors.slice(0, 5).join('; ')}`);
  }

  let imported = 0;

  for (const row of parsedRows) {
    const duplicate = await db.query<{ count: string | number }>(
      `SELECT COUNT(*) as count
       FROM bank_transactions
       WHERE tenant_id = $1
         AND account_id = $2
         AND date = $3
         AND ABS(amount - $4) < 0.01
         AND description = $5`,
      [tenantId, accountId, row.date, row.amount, row.description]
    );

    const count =
      typeof duplicate.rows[0]?.count === 'number'
        ? duplicate.rows[0].count
        : parseInt(String(duplicate.rows[0]?.count || '0'), 10);

    if (count > 0) {
      logger.debug('Skipping duplicate CSV row', {
        date: row.date,
        amount: row.amount,
        description: row.description,
      });
      continue;
    }

    await db.query(
      `INSERT INTO bank_transactions (
        id, tenant_id, account_id, transaction_id, date, amount, currency, description, created_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, 'GBP', $6, NOW()
      )`,
        [
          tenantId,
          accountId,
          row.reference ?? crypto.randomUUID(),
          row.date,
          row.amount,
          row.description,
        ]
    );

    imported++;
  }

  logger.info('CSV import completed', {
    tenantId,
    accountId,
    imported,
    total: parsedRows.length,
  });
  return imported;
}
