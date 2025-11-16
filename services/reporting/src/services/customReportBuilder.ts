import crypto from 'node:crypto';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('reporting-service');

export interface CustomReportDefinition {
  id: string;
  tenantId: TenantId;
  name: string;
  description: string;
  sections: ReportSection[];
  filters: ReportFilter[];
  format: 'table' | 'chart' | 'summary';
}

export interface ReportSection {
  type: 'revenue' | 'expense' | 'asset' | 'liability' | 'equity' | 'custom';
  accountCodes: string[];
  label: string;
  calculation?: 'sum' | 'average' | 'count' | 'custom';
}

export interface ReportFilter {
  field: string;
  operator: 'equals' | 'greater_than' | 'less_than' | 'between' | 'in';
  value: unknown;
}

/**
 * Generate custom report based on definition
 */
export async function generateCustomReport(
  tenantId: TenantId,
  definition: CustomReportDefinition,
  periodStart: Date,
  periodEnd: Date
): Promise<Record<string, unknown>> {
  logger.info('Generating custom report', { tenantId, reportId: definition.id });

  const report: Record<string, unknown> = {
    reportId: definition.id,
    reportName: definition.name,
    period: { start: periodStart, end: periodEnd },
    generatedAt: new Date(),
    sections: [],
  };

  // Generate each section
  for (const section of definition.sections) {
    const sectionData = await generateSection(
      tenantId,
      section,
      definition.filters,
      periodStart,
      periodEnd
    );
    (report.sections as unknown[]).push({
      ...section,
      data: sectionData,
    });
  }

  return report;
}

async function generateSection(
  tenantId: TenantId,
  section: ReportSection,
  filters: ReportFilter[],
  periodStart: Date,
  periodEnd: Date
): Promise<unknown> {
  let query = `
    SELECT 
      account_code,
      account_name,
      ${section.calculation === 'average' ? 'AVG' : section.calculation === 'count' ? 'COUNT' : 'SUM'}(amount) as value
    FROM ledger_entries
    WHERE tenant_id = $1
      AND transaction_date >= $2
      AND transaction_date <= $3
      AND account_code = ANY($4::text[])
  `;

  const params: unknown[] = [tenantId, periodStart, periodEnd, section.accountCodes];

  // Apply filters
  filters.forEach(filter => {
    const paramIndex = params.length + 1;
    switch (filter.operator) {
      case 'equals':
        query += ` AND ${filter.field} = $${paramIndex}`;
        params.push(filter.value);
        break;
      case 'greater_than':
        query += ` AND ${filter.field} > $${paramIndex}`;
        params.push(filter.value);
        break;
      case 'less_than':
        query += ` AND ${filter.field} < $${paramIndex}`;
        params.push(filter.value);
        break;
      case 'between':
        if (Array.isArray(filter.value) && filter.value.length === 2) {
          query += ` AND ${filter.field} BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
          params.push(filter.value[0], filter.value[1]);
        }
        break;
      case 'in':
        if (Array.isArray(filter.value)) {
          query += ` AND ${filter.field} = ANY($${paramIndex}::text[])`;
          params.push(filter.value);
        }
        break;
    }
  });

  query += ' GROUP BY account_code, account_name';

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Create custom report definition
 */
export async function createCustomReport(
  tenantId: TenantId,
  definition: Omit<CustomReportDefinition, 'id'>
): Promise<string> {
  const reportId = crypto.randomUUID();

  await db.query(
    `INSERT INTO custom_reports (
      id, tenant_id, name, description, sections, filters, format, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, NOW(), NOW())`,
    [
      reportId,
      tenantId,
      definition.name,
      definition.description,
      JSON.stringify(definition.sections),
      JSON.stringify(definition.filters),
      definition.format,
    ]
  );

  logger.info('Custom report created', { reportId, tenantId });
  return reportId;
}
