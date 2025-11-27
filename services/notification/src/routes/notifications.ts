import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { sendEmail, generateVATEstimationEmail } from '../services/email';
import { enhancedNotificationService } from '../services/enhancedNotification';
import { db } from '@ai-accountant/database';
import { sendReconciliationSummaryEmail } from '../services/reconciliationSummaryEmail';
import { authenticateServiceOrUser } from '../middleware/serviceAuth';

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
    const tenantResult = await db.query<{
      name: string;
      email: string;
    }>(
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
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    // Calculate estimated VAT (simplified)
    const ledgerResult = await db.query<{
      estimated_vat: string | number;
    }>(
      `SELECT COALESCE(SUM(tax_amount), 0) as estimated_vat
       FROM ledger_entries
       WHERE tenant_id = $1
         AND transaction_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
         AND transaction_date < DATE_TRUNC('month', CURRENT_DATE)`,
      [req.user.tenantId]
    );

    const row = ledgerResult.rows[0];
    const estimatedVAT = row ? (typeof row.estimated_vat === 'number' ? row.estimated_vat : parseFloat(String(row.estimated_vat || '0'))) : 0;

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

// Get notification preferences
router.get('/preferences', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await db.query<{
      email_enabled: boolean;
      sms_enabled: boolean;
      in_app_enabled: boolean;
      push_enabled: boolean;
      daily_digest_enabled: boolean;
      daily_digest_time: string;
      critical_alerts_enabled: boolean;
      quiet_hours_enabled: boolean;
      quiet_hours_start: string | null;
      quiet_hours_end: string | null;
    }>(
      `SELECT email_enabled, sms_enabled, in_app_enabled, push_enabled,
              daily_digest_enabled, daily_digest_time, critical_alerts_enabled,
              quiet_hours_enabled, quiet_hours_start, quiet_hours_end
       FROM notification_preferences
       WHERE tenant_id = $1 AND (user_id = $2 OR (user_id IS NULL AND $2 IS NULL))
       LIMIT 1`,
      [req.user.tenantId, req.user.userId]
    );

    const preferences = result.rows[0] || {
      email_enabled: true,
      sms_enabled: false,
      in_app_enabled: true,
      push_enabled: false,
      daily_digest_enabled: true,
      daily_digest_time: '09:00:00',
      critical_alerts_enabled: true,
      quiet_hours_enabled: false,
      quiet_hours_start: null,
      quiet_hours_end: null,
    };

    res.json({
      preferences,
      quietHoursEnabled: preferences.quiet_hours_enabled,
      quietHoursStart: preferences.quiet_hours_start,
      quietHoursEnd: preferences.quiet_hours_end,
    });
  } catch (error) {
    logger.error('Get preferences failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

// Update notification preferences
router.put('/preferences', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { preferences, quietHoursEnabled, quietHoursStart, quietHoursEnd } = req.body;

    await db.query(
      `INSERT INTO notification_preferences (
        tenant_id, user_id, email_enabled, sms_enabled, in_app_enabled, push_enabled,
        daily_digest_enabled, critical_alerts_enabled,
        quiet_hours_enabled, quiet_hours_start, quiet_hours_end, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (tenant_id, COALESCE(user_id, ''))
      DO UPDATE SET
        email_enabled = EXCLUDED.email_enabled,
        sms_enabled = EXCLUDED.sms_enabled,
        in_app_enabled = EXCLUDED.in_app_enabled,
        push_enabled = EXCLUDED.push_enabled,
        daily_digest_enabled = EXCLUDED.daily_digest_enabled,
        critical_alerts_enabled = EXCLUDED.critical_alerts_enabled,
        quiet_hours_enabled = EXCLUDED.quiet_hours_enabled,
        quiet_hours_start = EXCLUDED.quiet_hours_start,
        quiet_hours_end = EXCLUDED.quiet_hours_end,
        updated_at = NOW()`,
      [
        req.user.tenantId,
        req.user.userId,
        preferences?.email_enabled ?? true,
        preferences?.sms_enabled ?? false,
        preferences?.in_app_enabled ?? true,
        preferences?.push_enabled ?? false,
        preferences?.daily_digest_enabled ?? true,
        preferences?.critical_alerts_enabled ?? true,
        quietHoursEnabled ?? false,
        quietHoursStart || null,
        quietHoursEnd || null,
      ]
    );

    res.json({ message: 'Preferences updated' });
  } catch (error) {
    logger.error('Update preferences failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Get daily digest
router.get('/digest', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await enhancedNotificationService.generateDailyDigest(req.user.tenantId, req.user.userId);
    res.json({ message: 'Daily digest generated and sent' });
  } catch (error) {
    logger.error('Generate digest failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to generate digest' });
  }
});

router.post('/reconciliation-summary', authenticateServiceOrUser, async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId || (req.body?.tenantId as string | undefined);
    if (!tenantId) {
      res.status(400).json({ error: 'tenantId is required' });
      return;
    }

    const { tenantName, recipients, report } = req.body ?? {};
    if (!Array.isArray(recipients) || recipients.length === 0) {
      res.status(400).json({ error: 'At least one recipient is required' });
      return;
    }

    await sendReconciliationSummaryEmail({
      tenantName: tenantName || 'Your organisation',
      recipients,
      report,
    });

    res.json({ message: 'Reconciliation summary dispatched' });
  } catch (error) {
    logger.error(
      'Send reconciliation summary failed',
      error instanceof Error ? error : new Error(String(error))
    );
    res.status(500).json({ error: 'Failed to send reconciliation summary' });
  }
});

export { router as notificationRouter };
