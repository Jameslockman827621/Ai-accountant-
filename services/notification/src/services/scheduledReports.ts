import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';

const logger = createLogger('notification-service');

const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

export interface ScheduledReport {
  id: string;
  tenantId: TenantId;
  reportType: 'profit-loss' | 'balance-sheet' | 'cash-flow' | 'tax';
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  recipients: string[];
  format: 'pdf' | 'csv' | 'excel';
  lastSent: Date | null;
  nextSend: Date;
  isActive: boolean;
}

export async function createScheduledReport(
  tenantId: TenantId,
  reportType: ScheduledReport['reportType'],
  frequency: ScheduledReport['frequency'],
  recipients: string[],
  format: ScheduledReport['format'] = 'pdf'
): Promise<string> {
  const reportId = randomUUID();
  const nextSend = calculateNextSendDate(frequency);

  await db.query(
    `INSERT INTO scheduled_reports (
      id, tenant_id, report_type, frequency, recipients, format, next_send, is_active, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5::text[], $6, $7, true, NOW(), NOW())`,
    [reportId, tenantId, reportType, frequency, recipients, format, nextSend]
  );

  logger.info('Scheduled report created', {
    reportId,
    tenantId,
    reportType,
    frequency,
  });

  return reportId;
}

export async function processScheduledReports(): Promise<void> {
  logger.info('Processing scheduled reports');

  const now = new Date();
  const reports = await db.query<{
    id: string;
    tenant_id: string;
    report_type: string;
    frequency: string;
    recipients: string[];
    format: string;
    last_sent: Date | null;
  }>(
    `SELECT id, tenant_id, report_type, frequency, recipients, format, last_sent
     FROM scheduled_reports
     WHERE is_active = true
       AND next_send <= $1`,
    [now]
  );

  for (const report of reports.rows) {
    try {
      await generateAndSendReport({
        id: report.id,
        tenantId: report.tenant_id,
        reportType: report.report_type as ScheduledReport['reportType'],
        frequency: report.frequency as ScheduledReport['frequency'],
        recipients: report.recipients,
        format: report.format as ScheduledReport['format'],
        lastSent: report.last_sent,
        nextSend: calculateNextSendDate(report.frequency as ScheduledReport['frequency']),
        isActive: true,
      });

      // Update last sent and next send
      await db.query(
        `UPDATE scheduled_reports
         SET last_sent = NOW(), next_send = $1, updated_at = NOW()
         WHERE id = $2`,
        [calculateNextSendDate(report.frequency as ScheduledReport['frequency']), report.id]
      );
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Failed to process scheduled report', err, {
          reportId: report.id,
        });
      }
  }

  logger.info('Scheduled reports processing completed', {
    processed: reports.rows.length,
  });
}

async function generateAndSendReport(report: ScheduledReport): Promise<void> {
  logger.info('Generating and sending report', {
    reportId: report.id,
    reportType: report.reportType,
    tenantId: report.tenantId,
  });

  // Calculate date range based on frequency
  const dateRange = getDateRangeForFrequency(report.frequency);

  // Generate report based on type
  let reportData: unknown;
  let reportName: string;

    switch (report.reportType) {
      case 'profit-loss':
        reportData = await generateProfitAndLossReport(
          report.tenantId,
          dateRange.start,
          dateRange.end
        );
        reportName = 'Profit & Loss Statement';
        break;

      case 'tax':
        reportData = await generateTaxReportData(
          report.tenantId,
          dateRange.start,
          dateRange.end
        );
        reportName = 'Tax Report';
        break;

      default:
        throw new Error(`Unsupported report type: ${report.reportType}`);
    }

  // Format report based on format
  const formattedReport = formatReport(reportData, report.format);

  // Send email
    for (const recipient of report.recipients) {
      await emailTransporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@ai-accountant.com',
        to: recipient,
        subject: `${reportName} - ${new Date().toLocaleDateString('en-GB')}`,
        text: `Please find attached your ${reportName.toLowerCase()}.`,
        attachments: [
          {
            filename: `${reportName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.${report.format}`,
            content: formattedReport,
          },
        ],
      });
    }

  logger.info('Report sent successfully', {
    reportId: report.id,
    recipients: report.recipients,
  });
}

function calculateNextSendDate(frequency: ScheduledReport['frequency']): Date {
  const now = new Date();
  const next = new Date(now);

  switch (frequency) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    case 'quarterly':
      next.setMonth(next.getMonth() + 3);
      break;
  }

  return next;
}

function getDateRangeForFrequency(frequency: ScheduledReport['frequency']): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();

  switch (frequency) {
    case 'daily':
      start.setDate(start.getDate() - 1);
      break;
    case 'weekly':
      start.setDate(start.getDate() - 7);
      break;
    case 'monthly':
      start.setMonth(start.getMonth() - 1);
      break;
    case 'quarterly':
      start.setMonth(start.getMonth() - 3);
      break;
  }

  return { start, end };
}

function formatReport(data: unknown, format: ScheduledReport['format']): Buffer {
  const payload = {
    format,
    generatedAt: new Date().toISOString(),
    data,
  };
  return Buffer.from(JSON.stringify(payload, null, 2));
}

interface ProfitLossSummary {
  periodStart: Date;
  periodEnd: Date;
  revenue: number;
  expenses: number;
  profit: number;
}

async function generateProfitAndLossReport(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<ProfitLossSummary> {
  const result = await db.query<{
    revenue: string | number | null;
    expenses: string | number | null;
  }>(
    `SELECT 
        COALESCE(SUM(CASE WHEN entry_type = 'credit' AND account_code LIKE '4%' THEN amount ELSE 0 END), 0) as revenue,
        COALESCE(SUM(CASE WHEN entry_type = 'debit' AND (account_code LIKE '5%' OR account_code LIKE '6%') THEN amount ELSE 0 END), 0) as expenses
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3`,
    [tenantId, periodStart, periodEnd]
  );

  const revenue = typeof result.rows[0]?.revenue === 'number'
    ? result.rows[0]?.revenue ?? 0
    : parseFloat(String(result.rows[0]?.revenue || '0'));
  const expenses = typeof result.rows[0]?.expenses === 'number'
    ? result.rows[0]?.expenses ?? 0
    : parseFloat(String(result.rows[0]?.expenses || '0'));

  return {
    periodStart,
    periodEnd,
    revenue: Math.round(revenue * 100) / 100,
    expenses: Math.round(expenses * 100) / 100,
    profit: Math.round((revenue - expenses) * 100) / 100,
  };
}

interface TaxReportSummary {
  periodStart: Date;
  periodEnd: Date;
  filings: Array<{
    filingId: string;
    filingType: string;
    status: string;
    netVatDue?: number;
  }>;
}

async function generateTaxReportData(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<TaxReportSummary> {
  const result = await db.query<{
    id: string;
    filing_type: string;
    status: string;
    filing_data: { netVatDue?: number } | null;
  }>(
    `SELECT id, filing_type, status, filing_data
     FROM filings
     WHERE tenant_id = $1
       AND period_start >= $2
       AND period_end <= $3`,
    [tenantId, periodStart, periodEnd]
  );

  return {
    periodStart,
    periodEnd,
    filings: result.rows.map(row => ({
      filingId: row.id,
      filingType: row.filing_type,
      status: row.status,
      netVatDue:
        typeof row.filing_data?.netVatDue === 'number'
          ? Math.round(row.filing_data.netVatDue * 100) / 100
          : undefined,
    })),
  };
}
