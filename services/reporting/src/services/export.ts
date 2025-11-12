import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { generateProfitAndLoss, generateBalanceSheet, generateCashFlow } from './financialReports';

const logger = createLogger('reporting-service');

export async function exportReportToPDF(
  tenantId: TenantId,
  reportType: 'profit_loss' | 'balance_sheet' | 'cash_flow',
  periodStart: Date,
  periodEnd: Date
): Promise<string> {
  logger.info('Exporting report to PDF', { tenantId, reportType, periodStart, periodEnd });

  let reportData: Record<string, unknown>;

  switch (reportType) {
    case 'profit_loss':
      reportData = await generateProfitAndLoss(tenantId, periodStart, periodEnd);
      break;
    case 'balance_sheet':
      reportData = await generateBalanceSheet(tenantId, periodEnd);
      break;
    case 'cash_flow':
      reportData = await generateCashFlow(tenantId, periodStart, periodEnd);
      break;
    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }

  // In production, use a PDF library like pdfkit or puppeteer
  // For now, return JSON that can be converted to PDF
  const pdfContent = JSON.stringify(reportData, null, 2);

  // Store PDF (in production, would generate actual PDF)
  // For now, return a placeholder
  return `data:application/pdf;base64,${Buffer.from(pdfContent).toString('base64')}`;
}

export async function exportReportToExcel(
  tenantId: TenantId,
  reportType: 'profit_loss' | 'balance_sheet' | 'cash_flow',
  periodStart: Date,
  periodEnd: Date
): Promise<Buffer> {
  logger.info('Exporting report to Excel', { tenantId, reportType, periodStart, periodEnd });

  let reportData: Record<string, unknown>;

  switch (reportType) {
    case 'profit_loss':
      reportData = await generateProfitAndLoss(tenantId, periodStart, periodEnd);
      break;
    case 'balance_sheet':
      reportData = await generateBalanceSheet(tenantId, periodEnd);
      break;
    case 'cash_flow':
      reportData = await generateCashFlow(tenantId, periodStart, periodEnd);
      break;
    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }

  // In production, use a library like exceljs
  // For now, return CSV format
  const csvRows: string[] = [];
  
  // Convert report data to CSV
  if (reportType === 'profit_loss') {
    csvRows.push('Category,Amount');
    const pl = reportData as { revenue: number; expenses: number; profit: number };
    csvRows.push(`Revenue,${pl.revenue || 0}`);
    csvRows.push(`Expenses,${pl.expenses || 0}`);
    csvRows.push(`Profit,${pl.profit || 0}`);
  }

  return Buffer.from(csvRows.join('\n'), 'utf-8');
}

export async function scheduleReport(
  tenantId: TenantId,
  reportType: 'profit_loss' | 'balance_sheet' | 'cash_flow',
  schedule: 'daily' | 'weekly' | 'monthly',
  email: string
): Promise<string> {
  logger.info('Scheduling report', { tenantId, reportType, schedule, email });

  const scheduleId = crypto.randomUUID();

  // Store schedule in database (would need a scheduled_reports table)
  await db.query(
    `INSERT INTO scheduled_reports (
      id, tenant_id, report_type, schedule, email, is_active, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())`,
    [scheduleId, tenantId, reportType, schedule, email]
  );

  return scheduleId;
}
