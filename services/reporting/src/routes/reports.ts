import { Router, Response } from 'express';
import { ValidationError } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  generateProfitAndLoss,
  generateBalanceSheet,
  generateCashFlow,
} from '../services/financialReports';
import { exportReportToPDF, exportReportToExcel, scheduleReport } from '../services/export';
import { ReportType, ScheduleFrequency } from '../types/reportTypes';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();
// Generate Profit & Loss
router.get(
  '/profit-loss',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const startDate = parseDateQuery(req.query.startDate, 'startDate');
    const endDate = parseDateQuery(req.query.endDate, 'endDate');

    const report = await generateProfitAndLoss(req.user.tenantId, startDate, endDate);
    res.json({ report });
  })
);

// Generate Balance Sheet
router.get(
  '/balance-sheet',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const asOfDate = parseDateQuery(req.query.asOfDate, 'asOfDate');

    const report = await generateBalanceSheet(req.user.tenantId, asOfDate);
    res.json({ report });
  })
);

// Generate Cash Flow
router.get(
  '/cash-flow',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const startDate = parseDateQuery(req.query.startDate, 'startDate');
    const endDate = parseDateQuery(req.query.endDate, 'endDate');

    const report = await generateCashFlow(req.user.tenantId, startDate, endDate);
    res.json({ report });
  })
);

// Export report to PDF
router.get(
  '/:reportType/export/pdf',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const reportType = parseReportType(req.params.reportType);
    const periodStart = parseDateQuery(req.query.periodStart, 'periodStart');
    const periodEnd = parseDateQuery(req.query.periodEnd, 'periodEnd');

    const pdfData = await exportReportToPDF(req.user.tenantId, reportType, periodStart, periodEnd);
    res.setHeader('Content-Type', 'application/pdf');
    const filename = `${reportType}-${formatDateSlug(periodStart)}-${formatDateSlug(periodEnd)}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(pdfData.split(',')[1] ?? '', 'base64'));
  })
);

// Export report to Excel
router.get(
  '/:reportType/export/excel',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const reportType = parseReportType(req.params.reportType);
    const periodStart = parseDateQuery(req.query.periodStart, 'periodStart');
    const periodEnd = parseDateQuery(req.query.periodEnd, 'periodEnd');

    const excelBuffer = await exportReportToExcel(req.user.tenantId, reportType, periodStart, periodEnd);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const filename = `${reportType}-${formatDateSlug(periodStart)}-${formatDateSlug(periodEnd)}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(excelBuffer);
  })
);

// Schedule report
router.post(
  '/:reportType/schedule',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const reportType = parseReportType(req.params.reportType);
    const body = getBody(req);
    const schedule = parseSchedule(body.schedule);
    const email = parseString(body.email, 'email');

    const scheduleId = await scheduleReport(req.user.tenantId, reportType, schedule, email);
    res.status(201).json({ scheduleId, message: 'Report scheduled successfully' });
  })
);

export { router as reportingRouter };

const VALID_REPORT_TYPES: readonly ReportType[] = ['profit_loss', 'balance_sheet', 'cash_flow'] as const;
const VALID_SCHEDULES: readonly ScheduleFrequency[] = ['daily', 'weekly', 'monthly'] as const;

function getBody(req: AuthRequest): Record<string, unknown> {
  if (typeof req.body === 'object' && req.body !== null) {
    return req.body as Record<string, unknown>;
  }
  return {};
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`);
  }
  return value.trim();
}

function parseDateQuery(value: unknown, field: string): Date {
  const dateValue = parseString(value, field);
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${field} must be a valid date`);
  }
  return parsed;
}

function parseReportType(value: unknown): ReportType {
  const normalized = parseString(value, 'reportType');
  if (!VALID_REPORT_TYPES.includes(normalized as ReportType)) {
    throw new ValidationError('Invalid report type');
  }
  return normalized as ReportType;
}

function parseSchedule(value: unknown): ScheduleFrequency {
  const normalized = parseString(value, 'schedule').toLowerCase();
  if (!VALID_SCHEDULES.includes(normalized as ScheduleFrequency)) {
    throw new ValidationError('Invalid schedule value');
  }
  return normalized as ScheduleFrequency;
}

function formatDateSlug(date: Date): string {
  const [isoDate] = date.toISOString().split('T');
  return isoDate ?? date.toISOString();
}
