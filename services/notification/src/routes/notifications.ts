import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { sendEmail, generateVATEstimationEmail } from '../services/email';
import { enhancedNotificationService } from '../services/enhancedNotification';
import { db } from '@ai-accountant/database';
import { notificationManager } from '../services/notificationManager';
import { deliverWithResilience } from '../services/deliveryOrchestrator';

const router = Router();
const logger = createLogger('notification-service');

// Unified inbox for email, in-app, and webhook notifications
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const notifications = await notificationManager.getNotifications(
      req.user.tenantId,
      req.user.userId,
      false,
      100
    );

    const unreadCount = await notificationManager.getUnreadCount(req.user.tenantId, req.user.userId);
    const channelBreakdown = notifications.reduce(
      (acc, n) => {
        const channel = (n.metadata?.channel as string) || 'in_app';
        acc[channel] = (acc[channel] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    res.json({
      notifications,
      unreadCount,
      channelBreakdown,
    });
  } catch (error) {
    logger.error('Failed to load notifications', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

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

// Resilient dispatch API (email, in-app, webhook)
router.post('/send', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { templateId, variables, channels } = req.body;
    const deliveryIds = await deliverWithResilience({
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      templateId,
      variables,
      channels,
    });

    await notificationManager.createNotification(
      req.user.tenantId,
      req.user.userId,
      'info',
      'Notification queued',
      `Dispatch started for ${channels?.join(', ') || 'in_app'}`,
      undefined,
      {
        channel: channels?.join(',') || 'in_app',
        templateId,
        deliveryIds,
      }
    );

    res.json({ deliveryIds });
  } catch (error) {
    logger.error('Resilient dispatch failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to dispatch notification' });
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

router.post('/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await notificationManager.markAsRead(req.params.id, req.user.tenantId);
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    logger.error('Mark as read failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

router.post('/read-all', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await notificationManager.markAllAsRead(req.user.tenantId, req.user.userId);
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    logger.error('Mark all as read failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to mark all as read' });
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

export { router as notificationRouter };
