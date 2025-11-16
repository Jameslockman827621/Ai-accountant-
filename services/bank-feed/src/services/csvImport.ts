import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { parse } from 'csv-parse/sync';

const logger = createLogger('bank-feed-service');

export interface CSVImportResult {
  imported: number;
  skipped: number;
  errors: Array<{
    row: number;
    error: string;
  }>;
  duplicates: number;
}

/**
 * Manual CSV import fallback when bank feed fails
 */
export async function importTransactionsFromCSV(
  tenantId: TenantId,
  userId: UserId,
  csvContent: string,
  accountId: string,
  options?: {
    dateFormat?: string;
    skipHeader?: boolean;
    delimiter?: string;
  }
): Promise<CSVImportResult> {
  logger.info('Importing transactions from CSV', { tenantId, accountId });

  const result: CSVImportResult = {
    imported: 0,
    skipped: 0,
    errors: [],
    duplicates: 0,
  };

  try {
    // Parse CSV
    const records = parse(csvContent, {
      columns: options?.skipHeader !== false,
      skip_empty_lines: true,
      delimiter: options?.delimiter || ',',
      relax_column_count: true,
    });

    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('No valid records found in CSV');
    }

    // Expected columns: date, description, amount (or similar)
    // Try to auto-detect column names
    const firstRow = records[0];
    const dateColumn = findColumn(firstRow, ['date', 'transaction_date', 'transaction date', 'posted_date']);
    const amountColumn = findColumn(firstRow, ['amount', 'value', 'transaction_amount']);
    const descriptionColumn = findColumn(firstRow, ['description', 'memo', 'details', 'narration']);

    if (!dateColumn || !amountColumn) {
      throw new Error('Required columns (date, amount) not found in CSV');
    }

    // Process each row
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNumber = i + (options?.skipHeader !== false ? 2 : 1); // +1 for 1-indexed, +1 for header

      try {
        // Parse date
        const dateStr = row[dateColumn];
        if (!dateStr) {
          result.errors.push({ row: rowNumber, error: 'Missing date' });
          result.skipped++;
          continue;
        }

        const date = parseDate(dateStr, options?.dateFormat);
        if (!date) {
          result.errors.push({ row: rowNumber, error: `Invalid date: ${dateStr}` });
          result.skipped++;
          continue;
        }

        // Parse amount
        const amountStr = row[amountColumn];
        if (!amountStr) {
          result.errors.push({ row: rowNumber, error: 'Missing amount' });
          result.skipped++;
          continue;
        }

        const amount = parseFloat(String(amountStr).replace(/[£$,\s]/g, ''));
        if (Number.isNaN(amount)) {
          result.errors.push({ row: rowNumber, error: `Invalid amount: ${amountStr}` });
          result.skipped++;
          continue;
        }

        // Get description
        const description = row[descriptionColumn] || 'Imported transaction';

        // Check for duplicates
        const duplicateCheck = await db.query<{
          count: number;
        }>(
          `SELECT COUNT(*) as count
           FROM bank_transactions
           WHERE tenant_id = $1
             AND account_id = $2
             AND date = $3
             AND ABS(amount - $4) < 0.01
             AND description = $5`,
          [tenantId, accountId, date, amount, description]
        );

        if (parseInt(String(duplicateCheck.rows[0]?.count || 0), 10) > 0) {
          result.duplicates++;
          result.skipped++;
          continue;
        }

        // Import transaction
        const transactionId = randomUUID();
        await db.query(
          `INSERT INTO bank_transactions (
            id, tenant_id, account_id, transaction_id, date, amount,
            currency, description, reconciled, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, NOW())
          ON CONFLICT (tenant_id, account_id, transaction_id) DO NOTHING`,
          [
            transactionId,
            tenantId,
            accountId,
            `csv_${transactionId}`,
            date,
            amount,
            'GBP',
            description,
          ]
        );

        result.imported++;
      } catch (error) {
        result.errors.push({
          row: rowNumber,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        result.skipped++;
      }
    }

    logger.info('CSV import completed', {
      tenantId,
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    logger.error('CSV import failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

function findColumn(row: Record<string, unknown>, possibleNames: string[]): string | null {
  for (const name of possibleNames) {
    if (row[name]) {
      return name;
    }
    // Try case-insensitive
    const lowerName = name.toLowerCase();
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === lowerName) {
        return key;
      }
    }
  }
  return null;
}

function parseDate(dateStr: string, format?: string): Date | null {
  // Try common formats
  const formats = format
    ? [format]
    : [
        'YYYY-MM-DD',
        'DD/MM/YYYY',
        'MM/DD/YYYY',
        'DD-MM-YYYY',
        'MM-DD-YYYY',
        'YYYY/MM/DD',
      ];

  for (const fmt of formats) {
    try {
      // Simple date parsing (in production, use a proper date library)
      if (fmt === 'YYYY-MM-DD') {
        const date = new Date(dateStr);
        if (!Number.isNaN(date.getTime())) {
          return date;
        }
      } else if (fmt === 'DD/MM/YYYY' || fmt === 'DD-MM-YYYY') {
        const parts = dateStr.split(/[\/\-]/);
        if (parts.length === 3) {
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          const year = parseInt(parts[2], 10);
          const date = new Date(year, month, day);
          if (!Number.isNaN(date.getTime())) {
            return date;
          }
        }
      } else if (fmt === 'MM/DD/YYYY' || fmt === 'MM-DD-YYYY') {
        const parts = dateStr.split(/[\/\-]/);
        if (parts.length === 3) {
          const month = parseInt(parts[0], 10) - 1;
          const day = parseInt(parts[1], 10);
          const year = parseInt(parts[2], 10);
          const date = new Date(year, month, day);
          if (!Number.isNaN(date.getTime())) {
            return date;
          }
        }
      }
    } catch {
      // Try next format
    }
  }

  // Fallback to native Date parsing
  const date = new Date(dateStr);
  return Number.isNaN(date.getTime()) ? null : date;
}
