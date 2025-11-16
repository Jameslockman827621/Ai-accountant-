/**
 * Accountant Client Comparison API Routes
 */

import { Router } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';

const logger = createLogger('client-comparison-routes');
const router = Router();

// Get client comparison metrics
router.get('/clients/comparison', async (req, res) => {
  try {
    const { tenantIds } = req.query;
    
    if (!tenantIds || typeof tenantIds !== 'string') {
      return res.status(400).json({ error: 'tenantIds query parameter required' });
    }

    const tenantIdList = tenantIds.split(',').map(id => id.trim());

    const metrics = await Promise.all(
      tenantIdList.map(async (tenantId) => {
        // Get client name
        const client = await db.query<{ name: string }>(
          `SELECT name FROM tenants WHERE id = $1`,
          [tenantId]
        ).catch(() => ({ rows: [] }));

        // Get revenue and expenses for last 12 months
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 12);

        const revenue = await db.query<{ total: string | number }>(
          `SELECT COALESCE(SUM(amount), 0) as total
           FROM ledger_entries
           WHERE tenant_id = $1 AND account_type = 'revenue'
             AND transaction_date >= $2`,
          [tenantId, startDate]
        );

        const expenses = await db.query<{ total: string | number }>(
          `SELECT COALESCE(SUM(amount), 0) as total
           FROM ledger_entries
           WHERE tenant_id = $1 AND account_type = 'expense'
             AND transaction_date >= $2`,
          [tenantId, startDate]
        );

        const rev = typeof revenue.rows[0]?.total === 'number'
          ? revenue.rows[0].total
          : parseFloat(String(revenue.rows[0]?.total || '0'));
        const exp = typeof expenses.rows[0]?.total === 'number'
          ? expenses.rows[0].total
          : parseFloat(String(expenses.rows[0]?.total || '0'));

        const profit = rev - exp;
        const profitMargin = rev > 0 ? profit / rev : 0;

        // Get previous period for growth calculation
        const prevStartDate = new Date();
        prevStartDate.setMonth(prevStartDate.getMonth() - 24);
        const prevEndDate = new Date();
        prevEndDate.setMonth(prevEndDate.getMonth() - 12);

        const prevRevenue = await db.query<{ total: string | number }>(
          `SELECT COALESCE(SUM(amount), 0) as total
           FROM ledger_entries
           WHERE tenant_id = $1 AND account_type = 'revenue'
             AND transaction_date >= $2 AND transaction_date < $3`,
          [tenantId, prevStartDate, prevEndDate]
        );

        const prevRev = typeof prevRevenue.rows[0]?.total === 'number'
          ? prevRevenue.rows[0].total
          : parseFloat(String(prevRevenue.rows[0]?.total || '0'));

        const growthRate = prevRev > 0 ? (rev - prevRev) / prevRev : 0;

        // Get VAT due
        const vatDue = await db.query<{ total: string | number }>(
          `SELECT COALESCE(SUM(vat_due), 0) as total
           FROM filings
           WHERE tenant_id = $1 AND status = 'draft'
             AND period_end >= $2`,
          [tenantId, startDate]
        );

        const vat = typeof vatDue.rows[0]?.total === 'number'
          ? vatDue.rows[0].total
          : parseFloat(String(vatDue.rows[0]?.total || '0'));

        // Get upcoming deadlines
        const deadlines = await db.query<{ count: string | number }>(
          `SELECT COUNT(*) as count
           FROM filing_deadlines
           WHERE tenant_id = $1 AND due_date >= NOW() AND due_date <= NOW() + INTERVAL '90 days'`,
          [tenantId]
        );

        const deadlineCount = typeof deadlines.rows[0]?.count === 'number'
          ? deadlines.rows[0].count
          : parseInt(String(deadlines.rows[0]?.count || '0'), 10);

        return {
          tenantId,
          name: client.rows[0]?.name || tenantId,
          revenue: rev,
          expenses: exp,
          profit,
          profitMargin,
          growthRate,
          vatDue: vat,
          upcomingDeadlines: deadlineCount,
        };
      })
    );

    res.json({ metrics });
  } catch (error) {
    logger.error('Failed to get client comparison', error);
    res.status(500).json({ error: 'Failed to get client comparison' });
  }
});

export default router;
