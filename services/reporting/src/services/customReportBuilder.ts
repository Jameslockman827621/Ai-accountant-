import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('reporting-service');

export interface CustomReportConfig {
  name: string;
  description?: string;
  dateRange: { start: Date; end: Date };
  accounts: string[]; // Account codes to include
  grouping: 'none' | 'account' | 'month' | 'category';
  filters: {
    entryType?: 'debit' | 'credit' | 'both';
    minAmount?: number;
    maxAmount?: number;
    description?: string;
  };
  columns: Array<{
    field: string;
    label: string;
    format?: 'currency' | 'number' | 'date' | 'text';
  }>;
}

export interface CustomReportResult {
  config: CustomReportConfig;
  data: Array<Record<string, unknown>>;
  totals: Record<string, number>;
  generatedAt: Date;
}

export async function buildCustomReport(
  tenantId: TenantId,
  config: CustomReportConfig
): Promise<CustomReportResult> {
  logger.info('Building custom report', { tenantId, reportName: config.name });

  // Build query based on config
  let query = `
    SELECT 
      ${buildSelectClause(config.columns)}
    FROM ledger_entries
    WHERE tenant_id = $1
      AND transaction_date >= $2
      AND transaction_date <= $3
  `;

  const params: unknown[] = [tenantId, config.dateRange.start, config.dateRange.end];

  // Add account filter
  if (config.accounts.length > 0) {
    query += ` AND account_code = ANY($${params.length + 1})`;
    params.push(config.accounts);
  }

  // Add entry type filter
  if (config.filters.entryType && config.filters.entryType !== 'both') {
    query += ` AND entry_type = $${params.length + 1}`;
    params.push(config.filters.entryType);
  }

  // Add amount filters
  if (config.filters.minAmount !== undefined) {
    query += ` AND amount >= $${params.length + 1}`;
    params.push(config.filters.minAmount);
  }

  if (config.filters.maxAmount !== undefined) {
    query += ` AND amount <= $${params.length + 1}`;
    params.push(config.filters.maxAmount);
  }

  // Add description filter
  if (config.filters.description) {
    query += ` AND description ILIKE $${params.length + 1}`;
    params.push(`%${config.filters.description}%`);
  }

  // Add grouping
  if (config.grouping !== 'none') {
    query += ` GROUP BY ${getGroupByClause(config.grouping)}`;
  }

  query += ' ORDER BY transaction_date DESC';

  const result = await db.query(query, params);

  // Process data
  const data = result.rows.map(row => {
    const record: Record<string, unknown> = {};
    for (const column of config.columns) {
      const value = row[column.field];
      record[column.field] = formatValue(value, column.format);
    }
    return record;
  });

  // Calculate totals
  const totals: Record<string, number> = {};
  for (const column of config.columns) {
    if (column.format === 'currency' || column.format === 'number') {
      totals[column.field] = data.reduce((sum, row) => {
        const value = row[column.field];
        return sum + (typeof value === 'number' ? value : parseFloat(String(value || '0')));
      }, 0);
    }
  }

  logger.info('Custom report generated', {
    tenantId,
    reportName: config.name,
    rowCount: data.length,
  });

  return {
    config,
    data,
    totals,
    generatedAt: new Date(),
  };
}

function buildSelectClause(columns: CustomReportConfig['columns']): string {
  const selects: string[] = [];

  for (const column of columns) {
    switch (column.field) {
      case 'date':
        selects.push('transaction_date as date');
        break;
      case 'account':
        selects.push('account_code || \' - \' || account_name as account');
        break;
      case 'description':
        selects.push('description');
        break;
      case 'amount':
        selects.push('amount');
        break;
      case 'type':
        selects.push('entry_type as type');
        break;
      case 'tax':
        selects.push('COALESCE(tax_amount, 0) as tax');
        break;
      default:
        selects.push(column.field);
    }
  }

  return selects.join(', ');
}

function getGroupByClause(grouping: CustomReportConfig['grouping']): string {
  switch (grouping) {
    case 'account':
      return 'account_code, account_name';
    case 'month':
      return 'DATE_TRUNC(\'month\', transaction_date)';
    case 'category':
      return 'account_code';
    default:
      return '';
  }
}

function formatValue(value: unknown, format?: string): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  switch (format) {
    case 'currency':
      return typeof value === 'number' ? Math.round(value * 100) / 100 : parseFloat(String(value));
    case 'number':
      return typeof value === 'number' ? value : parseFloat(String(value));
    case 'date':
      return value instanceof Date ? value.toISOString().split('T')[0] : String(value);
    default:
      return value;
  }
}

export async function saveCustomReport(
  tenantId: TenantId,
  config: CustomReportConfig
): Promise<string> {
  const reportId = crypto.randomUUID();

  await db.query(
    `INSERT INTO custom_reports (
      id, tenant_id, name, description, config, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())`,
    [reportId, tenantId, config.name, config.description || '', JSON.stringify(config)]
  );

  logger.info('Custom report saved', { reportId, tenantId, name: config.name });
  return reportId;
}

export async function getCustomReports(tenantId: TenantId): Promise<Array<{
  id: string;
  name: string;
  description: string | null;
  config: CustomReportConfig;
  createdAt: Date;
}>> {
  const result = await db.query<{
    id: string;
    name: string;
    description: string | null;
    config: unknown;
    created_at: Date;
  }>(
    'SELECT id, name, description, config, created_at FROM custom_reports WHERE tenant_id = $1 ORDER BY created_at DESC',
    [tenantId]
  );

  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    config: row.config as CustomReportConfig,
    createdAt: row.created_at,
  }));
}
