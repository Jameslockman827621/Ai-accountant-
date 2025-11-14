import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  generateProfitAndLoss,
  generateBalanceSheet,
  generateCashFlow,
} from '../services/financialReports';

const router = Router();
const logger = createLogger('reporting-service');

// Generate Profit & Loss
router.get('/profit-loss', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw new ValidationError('Start date and end date are required');
    }

    const report = await generateProfitAndLoss(
      req.user.tenantId,
      new Date(startDate as string),
      new Date(endDate as string)
    );

    res.json({ report });
  } catch (error) {
    logger.error('Generate P&L failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to generate P&L' });
  }
});

// Generate Balance Sheet
router.get('/balance-sheet', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { asOfDate } = req.query;

    if (!asOfDate) {
      throw new ValidationError('As of date is required');
    }

    const report = await generateBalanceSheet(
      req.user.tenantId,
      new Date(asOfDate as string)
    );

    res.json({ report });
  } catch (error) {
    logger.error('Generate Balance Sheet failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to generate Balance Sheet' });
  }
});

// Generate Cash Flow
router.get('/cash-flow', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw new ValidationError('Start date and end date are required');
    }

    const report = await generateCashFlow(
      req.user.tenantId,
      new Date(startDate as string),
      new Date(endDate as string)
    );

    res.json({ report });
  } catch (error) {
    logger.error('Generate Cash Flow failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to generate Cash Flow' });
  }
});

// Export report to PDF
router.get('/:reportType/export/pdf', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { reportType } = req.params;
    const { periodStart, periodEnd } = req.query;

    if (!periodStart || !periodEnd) {
      throw new ValidationError('periodStart and periodEnd are required');
    }

    const { exportReportToPDF } = await import('../services/export');

    const pdfData = await exportReportToPDF(
      req.user.tenantId,
      reportType as any,
      new Date(periodStart as string),
      new Date(periodEnd as string)
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reportType}-${periodStart}-${periodEnd}.pdf"`);
    res.send(Buffer.from(pdfData.split(',')[1], 'base64'));
  } catch (error) {
    logger.error('Export PDF failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to export PDF' });
  }
});

// Export report to Excel
router.get('/:reportType/export/excel', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { reportType } = req.params;
    const { periodStart, periodEnd } = req.query;

    if (!periodStart || !periodEnd) {
      throw new ValidationError('periodStart and periodEnd are required');
    }

    const { exportReportToExcel } = await import('../services/export');

    const excelBuffer = await exportReportToExcel(
      req.user.tenantId,
      reportType as any,
      new Date(periodStart as string),
      new Date(periodEnd as string)
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${reportType}-${periodStart}-${periodEnd}.xlsx"`);
    res.send(excelBuffer);
  } catch (error) {
    logger.error('Export Excel failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to export Excel' });
  }
});

// Schedule report
router.post('/:reportType/schedule', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { reportType } = req.params;
    const { schedule, email } = req.body;

    if (!schedule || !email) {
      throw new ValidationError('schedule and email are required');
    }

    const { scheduleReport } = await import('../services/export');

    const scheduleId = await scheduleReport(
      req.user.tenantId,
      reportType as any,
      schedule,
      email
    );

    res.status(201).json({ scheduleId, message: 'Report scheduled successfully' });
  } catch (error) {
    logger.error('Schedule report failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to schedule report' });
  }
});

export { router as reportingRouter };
