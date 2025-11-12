import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { sendEmail, generateVATEstimationEmail } from '../services/email';
import { db } from '@ai-accountant/database';

const router = Router();
const logger = createLogger('notification-service');

// Send VAT estimation email
router.post('/vat-estimation', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { period } = req.body;

    // Get tenant info
    const tenantResult = await db.query(
      `SELECT t.name, u.email
       FROM tenants t
       JOIN users u ON u.tenant_id = t.id
       WHERE t.id = $1 AND u.id = $2`,
      [req.user.tenantId, req.user.userId]
    );

    if (tenantResult.rows.length === 0) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const tenant = tenantResult.rows[0];

    // Calculate estimated VAT (simplified)
    const ledgerResult = await db.query(
      `SELECT COALESCE(SUM(tax_amount), 0) as estimated_vat
       FROM ledger_entries
       WHERE tenant_id = $1
         AND transaction_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
         AND transaction_date < DATE_TRUNC('month', CURRENT_DATE)`,
      [req.user.tenantId]
    );

    const estimatedVAT = parseFloat(ledgerResult.rows[0]?.estimated_vat || '0');

    const { subject, html } = generateVATEstimationEmail(
      estimatedVAT,
      period || 'current period',
      tenant.name
    );

    await sendEmail(tenant.email, subject, html);

    res.json({ message: 'VAT estimation email sent' });
  } catch (error) {
    logger.error('Send VAT estimation failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to send VAT estimation' });
  }
});

export { router as notificationRouter };
