import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';

export interface VarianceSummary {
  referenceFilingId?: string;
  periodChange?: number;
  taxChange?: number;
  confidence?: number;
  insights: string[];
}

export async function buildVarianceSummary(
  filingId: string,
  tenantId: TenantId,
  filingType: string,
  filingData: Record<string, unknown>
): Promise<VarianceSummary | null> {
  const previous = await db.query<{
    id: string;
    filing_data: Record<string, unknown> | null;
  }>(
    `SELECT id, filing_data
       FROM filings
      WHERE tenant_id = $1
        AND filing_type = $2
        AND id <> $3
      ORDER BY period_end DESC
      LIMIT 1`,
    [tenantId, filingType, filingId]
  );

  if (previous.rows.length === 0) {
    return null;
  }

  const prev = previous.rows[0];
  const currentSales = numberFromPath(filingData, ['totalSales']) ?? numberFromPath(filingData, ['vatOutput']) ?? 0;
  const previousSales =
    numberFromPath(prev.filing_data || {}, ['totalSales']) ??
    numberFromPath(prev.filing_data || {}, ['vatOutput']) ??
    0;
  const currentTax =
    numberFromPath(filingData, ['totalVAT']) ??
    numberFromPath(filingData, ['netVAT']) ??
    numberFromPath(filingData, ['corporationTax']) ??
    0;
  const previousTax =
    numberFromPath(prev.filing_data || {}, ['totalVAT']) ??
    numberFromPath(prev.filing_data || {}, ['netVAT']) ??
    numberFromPath(prev.filing_data || {}, ['corporationTax']) ??
    0;

  const periodChange = previousSales === 0 ? 1 : (currentSales - previousSales) / previousSales;
  const taxChange = previousTax === 0 ? 1 : (currentTax - previousTax) / previousTax;

  const insights: string[] = [];
  if (Math.abs(periodChange) > 0.15) {
    insights.push(
      `Revenue moved ${Math.round(periodChange * 100)}% compared to the previous period. Review supporting documents.`
    );
  }
  if (Math.abs(taxChange) > 0.15) {
    insights.push(
      `Tax liability shifted ${Math.round(taxChange * 100)}% period-over-period. Validate adjustments and exemptions.`
    );
  }

  return {
    referenceFilingId: prev.id,
    periodChange,
    taxChange,
    confidence: insights.length === 0 ? 95 : 80,
    insights,
  };
}

function numberFromPath(payload: Record<string, unknown>, path: string[]): number | undefined {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  if (typeof current === 'number') {
    return current;
  }

  if (typeof current === 'string') {
    const parsed = parseFloat(current);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
}
