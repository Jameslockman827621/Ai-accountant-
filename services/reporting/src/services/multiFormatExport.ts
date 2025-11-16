import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { ProfitAndLoss } from './financialReports';
import { exportReportToPDF, exportReportToExcel } from './export';
import { loadReportData } from './reportData';
import { ReportType } from '../types/reportTypes';

const logger = createLogger('reporting-service');

export type ExportFormat = 'csv' | 'excel' | 'pdf' | 'json' | 'xml';

/**
 * Export report in multiple formats
 */
export async function exportReportMultiFormat(
  tenantId: TenantId,
  reportType: ReportType,
  periodStart: Date,
  periodEnd: Date,
  format: ExportFormat
): Promise<Buffer | string> {
  logger.info('Exporting report', { tenantId, reportType, format });

  const reportData = await loadReportData(tenantId, reportType, periodStart, periodEnd);

  switch (format) {
    case 'csv': {
      return exportToCSV(reportData, reportType);
    }
    case 'excel': {
      return exportReportToExcel(tenantId, reportType, periodStart, periodEnd);
    }
    case 'pdf': {
      const pdfData = await exportReportToPDF(tenantId, reportType, periodStart, periodEnd);
      return Buffer.from(pdfData.split(',')[1] ?? '', 'base64');
    }
    case 'json': {
      return Buffer.from(JSON.stringify(reportData, null, 2), 'utf-8');
    }
    case 'xml': {
      return exportToXML(reportData, reportType);
    }
    default: {
      throw new Error(`Unsupported format: ${String(format)}`);
    }
  }
}

function exportToCSV(data: Record<string, unknown>, reportType: ReportType): Buffer {
  const rows: string[] = [];

  if (reportType === 'profit_loss') {
    rows.push('Category,Amount');
    const pl = data as ProfitAndLoss;
    rows.push(`Revenue,${pl.revenue.total}`);
    rows.push(`Expenses,${pl.expenses.total}`);
    rows.push(`Net Profit,${pl.netProfit}`);
  }

  return Buffer.from(rows.join('\n'), 'utf-8');
}

function exportToXML(data: Record<string, unknown>, reportType: ReportType): Buffer {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<report type="${reportType}">\n`;

  if (reportType === 'profit_loss') {
    const pl = data as ProfitAndLoss;
    xml += `  <revenue>${pl.revenue.total}</revenue>\n`;
    xml += `  <expenses>${pl.expenses.total}</expenses>\n`;
    xml += `  <netProfit>${pl.netProfit}</netProfit>\n`;
  }

  xml += '</report>';
  return Buffer.from(xml, 'utf-8');
}
