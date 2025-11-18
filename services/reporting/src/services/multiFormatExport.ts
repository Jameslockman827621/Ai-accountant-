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
      if (reportType !== 'profit_loss') {
        throw new Error('CSV export is only supported for profit and loss reports');
      }
      return exportProfitAndLossToCSV(reportData as ProfitAndLoss);
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
      if (reportType !== 'profit_loss') {
        throw new Error('XML export is only supported for profit and loss reports');
      }
      return exportProfitAndLossToXML(reportData as ProfitAndLoss);
    }
    default: {
      throw new Error(`Unsupported format: ${String(format)}`);
    }
  }
}

function exportProfitAndLossToCSV(data: ProfitAndLoss): Buffer {
  const rows: string[] = [];

  rows.push('Category,Amount');
  rows.push(`Revenue,${data.revenue.total}`);
  rows.push(`Expenses,${data.expenses.total}`);
  rows.push(`Net Profit,${data.netProfit}`);

  return Buffer.from(rows.join('\n'), 'utf-8');
}

function exportProfitAndLossToXML(data: ProfitAndLoss): Buffer {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<report type="profit_loss">\n`;
  xml += `  <revenue>${data.revenue.total}</revenue>\n`;
  xml += `  <expenses>${data.expenses.total}</expenses>\n`;
  xml += `  <netProfit>${data.netProfit}</netProfit>\n`;

  xml += '</report>';
  return Buffer.from(xml, 'utf-8');
}
