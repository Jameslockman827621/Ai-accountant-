import { db, getLatestFilingVersion, recordFilingDiff, recordFilingVersion } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('filing-service');

export interface FilingComparison {
  currentFiling: {
    id: string;
    periodStart: Date;
    periodEnd: Date;
    data: Record<string, unknown>;
  };
  previousFiling?: {
    id: string;
    periodStart: Date;
    periodEnd: Date;
    data: Record<string, unknown>;
  };
  yearOverYear?: {
    previousYear: {
      id: string;
      periodStart: Date;
      periodEnd: Date;
      data: Record<string, unknown>;
    };
  };
  differences: Array<{
    field: string;
    currentValue: unknown;
    previousValue: unknown;
    difference: number;
    percentageChange: number;
    significance: 'low' | 'medium' | 'high';
  }>;
  warnings: string[];
}

/**
 * Compare filings period-over-period and year-over-year
 * Helps identify unusual changes or errors
 */
export async function compareFilings(
  tenantId: TenantId,
  filingId: string,
  comparisonType: 'period' | 'year' | 'both' = 'both'
): Promise<FilingComparison> {
  logger.info('Comparing filings', { tenantId, filingId, comparisonType });

  // Get current filing
  const currentResult = await db.query<{
    id: string;
    filing_type: string;
    period_start: Date;
    period_end: Date;
    filing_data: Record<string, unknown>;
  }>(
    `SELECT id, filing_type, period_start, period_end, filing_data
     FROM filings
     WHERE id = $1 AND tenant_id = $2`,
    [filingId, tenantId]
  );

  if (currentResult.rows.length === 0) {
    throw new Error('Filing not found');
  }

  const current = currentResult.rows[0];
  const currentFiling = {
    id: current.id,
    periodStart: current.period_start,
    periodEnd: current.period_end,
    data: current.filing_data,
  };

  const differences: FilingComparison['differences'] = [];
  const warnings: string[] = [];

  let previousFiling: FilingComparison['previousFiling'];
  let yearOverYear: FilingComparison['yearOverYear'];

  // Period-over-period comparison
  if (comparisonType === 'period' || comparisonType === 'both') {
    const previousResult = await db.query<{
      id: string;
      period_start: Date;
      period_end: Date;
      filing_data: Record<string, unknown>;
    }>(
      `SELECT id, period_start, period_end, filing_data
       FROM filings
       WHERE tenant_id = $1
         AND filing_type = $2
         AND period_end < $3
       ORDER BY period_end DESC
       LIMIT 1`,
      [tenantId, current.filing_type, current.period_start]
    );

    if (previousResult.rows.length > 0) {
      const prev = previousResult.rows[0];
      previousFiling = {
        id: prev.id,
        periodStart: prev.period_start,
        periodEnd: prev.period_end,
        data: prev.filing_data,
      };

      // Compare key fields
      const keyFields = getKeyFieldsForFilingType(current.filing_type);
      for (const field of keyFields) {
        const currentValue = getFieldValue(current.filing_data, field);
        const previousValue = getFieldValue(prev.filing_data, field);

        if (typeof currentValue === 'number' && typeof previousValue === 'number') {
          const difference = currentValue - previousValue;
          const percentageChange = previousValue !== 0
            ? (difference / previousValue) * 100
            : 0;

          let significance: 'low' | 'medium' | 'high' = 'low';
          if (Math.abs(percentageChange) > 50) significance = 'high';
          else if (Math.abs(percentageChange) > 20) significance = 'medium';

          differences.push({
            field,
            currentValue,
            previousValue,
            difference,
            percentageChange,
            significance,
          });

          // Add warnings for significant changes
          if (Math.abs(percentageChange) > 50) {
            warnings.push(
              `Significant change in ${field}: ${percentageChange > 0 ? '+' : ''}${percentageChange.toFixed(1)}%`
            );
          }
        }
      }
    }
  }

  // Year-over-year comparison
  if (comparisonType === 'year' || comparisonType === 'both') {
    const oneYearAgo = new Date(current.period_start);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const yoyResult = await db.query<{
      id: string;
      period_start: Date;
      period_end: Date;
      filing_data: Record<string, unknown>;
    }>(
      `SELECT id, period_start, period_end, filing_data
       FROM filings
       WHERE tenant_id = $1
         AND filing_type = $2
         AND period_start >= $3
         AND period_end <= $4
       ORDER BY period_end DESC
       LIMIT 1`,
      [
        tenantId,
        current.filing_type,
        oneYearAgo,
        new Date(oneYearAgo.getTime() + (current.period_end.getTime() - current.period_start.getTime())),
      ]
    );

    if (yoyResult.rows.length > 0) {
      const yoy = yoyResult.rows[0];
      yearOverYear = {
        previousYear: {
          id: yoy.id,
          periodStart: yoy.period_start,
          periodEnd: yoy.period_end,
          data: yoy.filing_data,
        },
      };

      // Compare year-over-year
      const keyFields = getKeyFieldsForFilingType(current.filing_type);
      for (const field of keyFields) {
        const currentValue = getFieldValue(current.filing_data, field);
        const yoyValue = getFieldValue(yoy.filing_data, field);

        if (typeof currentValue === 'number' && typeof yoyValue === 'number') {
          const difference = currentValue - yoyValue;
          const percentageChange = yoyValue !== 0
            ? (difference / yoyValue) * 100
            : 0;

          let significance: 'low' | 'medium' | 'high' = 'low';
          if (Math.abs(percentageChange) > 50) significance = 'high';
          else if (Math.abs(percentageChange) > 20) significance = 'medium';

          // Only add if not already in differences (avoid duplicates)
          const existing = differences.find(d => d.field === field);
          if (!existing) {
            differences.push({
              field: `${field}_yoy`,
              currentValue,
              previousValue: yoyValue,
              difference,
              percentageChange,
              significance,
            });
          }

          // Add warnings for significant year-over-year changes
          if (Math.abs(percentageChange) > 50) {
            warnings.push(
              `Significant year-over-year change in ${field}: ${percentageChange > 0 ? '+' : ''}${percentageChange.toFixed(1)}%`
            );
          }
        }
      }
    }
  }

  try {
    const latestVersion = await getLatestFilingVersion(filingId, tenantId);
    const { versionNumber } = await recordFilingVersion({
      filingId,
      tenantId,
      snapshot: current.filing_data,
      source: 'comparison',
    });

    if (previousFiling && latestVersion) {
      await recordFilingDiff({
        filingId,
        tenantId,
        fromVersion: latestVersion.versionNumber,
        toVersion: versionNumber,
        diff: {
          differences,
          warnings,
          previousFiling: previousFiling.data,
        },
      });
    }
  } catch (err) {
    logger.warn('Failed to persist filing version comparison', err as Error);
  }

  return {
    currentFiling,
    previousFiling,
    yearOverYear,
    differences,
    warnings,
  };
}

function getKeyFieldsForFilingType(filingType: string): string[] {
  const fieldMap: Record<string, string[]> = {
    vat: ['vatOutput', 'vatInput', 'vatNet', 'totalSales', 'totalPurchases'],
    paye: ['totalPAYE', 'employeeCount', 'grossPay', 'netPay'],
    corporation_tax: ['profit', 'corporationTax', 'revenue', 'expenses'],
  };

  return fieldMap[filingType] || [];
}

function getFieldValue(data: Record<string, unknown>, field: string): number {
  // Try various field name formats
  const value = data[field] || data[field.toLowerCase()] || data[field.toUpperCase()];
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}
