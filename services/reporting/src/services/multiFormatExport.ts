import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { generateProfitAndLoss, generateBalanceSheet, generateCashFlow } from './financialReports';
import { exportReportToPDF, exportReportToExcel } from './export';

const logger = createLogger('reporting-service');

export type ExportFormat = 'csv' | 'excel' | 'pdf' | 'json' | 'xml';

/**
 * Export report in multiple formats
 */
export async function exportReportMultiFormat(
  tenantId: TenantId,
  reportType: 'profit_loss' | 'balance_sheet' | 'cash_flow',
  periodStart: Date,
  periodEnd: Date,
  format: ExportFormat
): Promise<Buffer | string> {
  logger.info('Exporting report', { tenantId, reportType, format });

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

  switch (format) {
    case 'csv':
      return exportToCSV(reportData, reportType);
    case 'excel':
      return await exportReportToExcel(tenantId, reportType, periodStart, periodEnd);
    case 'pdf':
      const pdfData = await exportReportToPDF(tenantId, reportType, periodStart, periodEnd);
      return Buffer.from(pdfData.split(',')[1], 'base64');
    case 'json':
      return Buffer.from(JSON.stringify(reportData, null, 2), 'utf-8');
    case 'xml':
      return exportToXML(reportData, reportType);
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

function exportToCSV(data: Record<string, unknown>, reportType: string): Buffer {
  const rows: string[] = [];

  if (reportType === 'profit_loss') {
    rows.push('Category,Amount');
    const pl = data as { revenue: { total: number }; expenses: { total: number }; netProfit: number };
    rows.push(`Revenue,${pl.revenue?.total || 0}`);
    rows.push(`Expenses,${pl.expenses?.total || 0}`);
    rows.push(`Net Profit,${pl.netProfit || 0}`);
  }

  return Buffer.from(rows.join('\n'), 'utf-8');
}

function exportToXML(data: Record<string, unknown>, reportType: string): Buffer {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<report type="${reportType}">\n`;

  if (reportType === 'profit_loss') {
    const pl = data as { revenue: { total: number }; expenses: { total: number }; netProfit: number };
    xml += `  <revenue>${pl.revenue?.total || 0}</revenue>\n`;
    xml += `  <expenses>${pl.expenses?.total || 0}</expenses>\n`;
    xml += `  <netProfit>${pl.netProfit || 0}</netProfit>\n`;
  }

  xml += '</report>';
  return Buffer.from(xml, 'utf-8');
}
