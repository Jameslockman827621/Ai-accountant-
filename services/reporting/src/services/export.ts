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

  // Generate PDF using PDFKit
  try {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {});

    // Add content
    doc.fontSize(20).text('Financial Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Report Type: ${reportType}`, { align: 'left' });
    doc.text(`Period: ${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()}`);
    doc.moveDown();

    // Add report data
    if (reportType === 'profit_loss') {
      const pl = reportData as { revenue: { total: number }; expenses: { total: number }; netProfit: number };
      doc.text(`Revenue: £${pl.revenue?.total?.toFixed(2) || '0.00'}`);
      doc.text(`Expenses: £${pl.expenses?.total?.toFixed(2) || '0.00'}`);
      doc.text(`Net Profit: £${pl.netProfit?.toFixed(2) || '0.00'}`);
    }

    doc.end();

    // Wait for PDF to be generated
    await new Promise<void>((resolve) => {
      doc.on('end', resolve);
      setTimeout(resolve, 1000); // Fallback timeout
    });

    const pdfBuffer = Buffer.concat(chunks);
    return `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
  } catch (error) {
    logger.error('PDF generation failed, falling back to JSON', error instanceof Error ? error : new Error(String(error)));
    // Fallback to JSON
    const pdfContent = JSON.stringify(reportData, null, 2);
    return `data:application/pdf;base64,${Buffer.from(pdfContent).toString('base64')}`;
  }
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

  // Generate Excel using ExcelJS
  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report');

    // Add headers
    if (reportType === 'profit_loss') {
      worksheet.columns = [
        { header: 'Category', key: 'category', width: 30 },
        { header: 'Amount', key: 'amount', width: 15 },
      ];

      const pl = reportData as { revenue: { total: number }; expenses: { total: number }; netProfit: number };
      worksheet.addRow({ category: 'Revenue', amount: pl.revenue?.total || 0 });
      worksheet.addRow({ category: 'Expenses', amount: pl.expenses?.total || 0 });
      worksheet.addRow({ category: 'Net Profit', amount: pl.netProfit || 0 });
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  } catch (error) {
    logger.error('Excel generation failed, falling back to CSV', error instanceof Error ? error : new Error(String(error)));
    // Fallback to CSV
    const csvRows: string[] = [];
    
    if (reportType === 'profit_loss') {
      csvRows.push('Category,Amount');
      const pl = reportData as { revenue: { total: number }; expenses: { total: number }; netProfit: number };
      csvRows.push(`Revenue,${pl.revenue?.total || 0}`);
      csvRows.push(`Expenses,${pl.expenses?.total || 0}`);
      csvRows.push(`Net Profit,${pl.netProfit || 0}`);
    }

    return Buffer.from(csvRows.join('\n'), 'utf-8');
  }
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
