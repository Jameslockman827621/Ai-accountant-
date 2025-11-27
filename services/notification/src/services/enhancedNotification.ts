import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { sendEmail } from './email';

const logger = createLogger('enhanced-notification');

export type NotificationChannel = 'email' | 'sms' | 'in_app' | 'push' | 'webhook';
export type NotificationCategory = 'digest' | 'alert' | 'reminder' | 'system';

export interface NotificationTemplate {
  id: string;
  name: string;
  category: NotificationCategory;
  subject: string;
  htmlTemplate: string;
  textTemplate: string;
  variables: string[]; // List of required variables
}

export interface ScheduledNotification {
  id: string;
  tenantId: TenantId;
  userId: UserId | null;
  templateId: string;
  scheduledAt: Date;
  channel: NotificationChannel;
  variables: Record<string, unknown>;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
}

export class EnhancedNotificationService {
  /**
   * Send notification via multiple channels
   */
  async sendNotification(
    tenantId: TenantId,
    userId: UserId | null,
    templateId: string,
    variables: Record<string, unknown>,
    channels: NotificationChannel[] = ['email', 'in_app']
  ): Promise<string[]> {
    const deliveryIds: string[] = [];

    // Get user preferences
    const preferences = await this.getNotificationPreferences(tenantId, userId);

    for (const channel of channels) {
      // Check if channel is enabled
      if (!this.isChannelEnabled(preferences, channel)) {
        logger.debug('Channel disabled by user preference', { tenantId, userId, channel });
        continue;
      }

      // Check quiet hours
      if (this.isQuietHours(preferences)) {
        logger.debug('Quiet hours active, deferring notification', { tenantId, userId });
        // Would schedule for later
        continue;
      }

      try {
        const deliveryId = await this.sendViaChannel(
          tenantId,
          userId,
          templateId,
          variables,
          channel
        );
        deliveryIds.push(deliveryId);
      } catch (error) {
        logger.error('Notification delivery failed', {
          tenantId,
          userId,
          channel,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    return deliveryIds;
  }

  /**
   * Schedule notification
   */
  async scheduleNotification(
    tenantId: TenantId,
    userId: UserId | null,
    templateId: string,
    scheduledAt: Date,
    variables: Record<string, unknown>,
    channel: NotificationChannel
  ): Promise<string> {
    const scheduleId = randomUUID();

    await db.query(
      `INSERT INTO scheduled_notifications (
        id, tenant_id, user_id, template_id, scheduled_at,
        channel, variables, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW(), NOW())`,
      [
        scheduleId,
        tenantId,
        userId,
        templateId,
        scheduledAt,
        channel,
        JSON.stringify(variables),
        'pending',
      ]
    );

    logger.info('Notification scheduled', { scheduleId, tenantId, scheduledAt });

    return scheduleId;
  }

  /**
   * Generate daily digest
   */
  async generateDailyDigest(tenantId: TenantId, userId: UserId): Promise<void> {
    const preferences = await this.getNotificationPreferences(tenantId, userId);

    if (!preferences.daily_digest_enabled) {
      return;
    }

    // Collect digest items
    const digestItems = await this.collectDigestItems(tenantId);

    if (digestItems.length === 0) {
      logger.debug('No digest items, skipping', { tenantId, userId });
      return;
    }

    // Generate digest content
    const digestContent = this.formatDigestContent(digestItems);

    // Send digest
    await this.sendNotification(
      tenantId,
      userId,
      'daily_digest',
      {
        items: digestItems,
        content: digestContent,
        date: new Date().toLocaleDateString(),
      },
      ['email', 'in_app']
    );

    logger.info('Daily digest sent', { tenantId, userId, itemCount: digestItems.length });
  }

  /**
   * Send via specific channel
   */
  private async sendViaChannel(
    tenantId: TenantId,
    userId: UserId | null,
    templateId: string,
    variables: Record<string, unknown>,
    channel: NotificationChannel
  ): Promise<string> {
    const deliveryId = randomUUID();

    // Get template
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Render template
    const rendered = this.renderTemplate(template, variables);

    // Send via channel
    let providerMessageId: string | undefined;
    let status: 'sent' | 'failed' = 'sent';

    try {
      switch (channel) {
        case 'email':
          await sendEmail(
            await this.getUserEmail(userId || tenantId),
            rendered.subject,
            rendered.html
          );
          providerMessageId = `email_${deliveryId}`;
          break;

        case 'sms':
          // In production, would use SMS provider
          logger.info('SMS notification', { deliveryId });
          providerMessageId = `sms_${deliveryId}`;
          break;

        case 'webhook':
          await this.dispatchWebhook(rendered, variables);
          providerMessageId = `webhook_${deliveryId}`;
          break;

        case 'in_app':
          // Create in-app notification
          await this.createInAppNotification(tenantId, userId, rendered.subject, rendered.text);
          providerMessageId = `inapp_${deliveryId}`;
          break;

        case 'push':
          // In production, would use push notification service
          logger.info('Push notification', { deliveryId });
          providerMessageId = `push_${deliveryId}`;
          break;
      }
    } catch (error) {
      status = 'failed';
      logger.error('Channel delivery failed', {
        channel,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }

    // Log delivery
    await db.query(
      `INSERT INTO notification_delivery_log (
        id, tenant_id, user_id, notification_type, notification_category,
        channel, subject, template_id, template_variables, status,
        provider_message_id, sent_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, NOW(), NOW(), NOW())`,
      [
        deliveryId,
        tenantId,
        userId,
        templateId,
        template.category,
        channel,
        rendered.subject,
        templateId,
        JSON.stringify(variables),
        status,
        providerMessageId,
      ]
    );

    return deliveryId;
  }

  private async dispatchWebhook(
    rendered: { subject: string; html: string; text: string },
    variables: Record<string, unknown>
  ): Promise<void> {
    const webhookUrl = variables.webhookUrl as string | undefined;
    if (!webhookUrl) {
      throw new Error('Webhook URL missing from template variables');
    }

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: rendered.subject,
        body: rendered.text,
        metadata: variables,
      }),
    });
  }

  /**
   * Get notification preferences
   */
  private async getNotificationPreferences(
    tenantId: TenantId,
    userId: UserId | null
  ): Promise<{
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
  }> {
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
      [tenantId, userId]
    );

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    // Return defaults
    return {
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
  }

  /**
   * Check if channel is enabled
   */
  private isChannelEnabled(
    preferences: Awaited<ReturnType<typeof this.getNotificationPreferences>>,
    channel: NotificationChannel
  ): boolean {
    switch (channel) {
      case 'email':
        return preferences.email_enabled;
      case 'sms':
        return preferences.sms_enabled;
      case 'in_app':
        return preferences.in_app_enabled;
      case 'push':
        return preferences.push_enabled;
      default:
        return false;
    }
  }

  /**
   * Check if quiet hours are active
   */
  private isQuietHours(
    preferences: Awaited<ReturnType<typeof this.getNotificationPreferences>>
  ): boolean {
    if (!preferences.quiet_hours_enabled) {
      return false;
    }

    if (!preferences.quiet_hours_start || !preferences.quiet_hours_end) {
      return false;
    }

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:00`;

    return currentTime >= preferences.quiet_hours_start && currentTime <= preferences.quiet_hours_end;
  }

  /**
   * Get template
   */
  private async getTemplate(templateId: string): Promise<NotificationTemplate | null> {
    // In production, would load from database or template store
    // For now, return mock template
    return {
      id: templateId,
      name: 'Daily Digest',
      category: 'digest',
      subject: 'Your Daily Accounting Digest',
      htmlTemplate: '<h1>{{title}}</h1><p>{{content}}</p>',
      textTemplate: '{{title}}\n\n{{content}}',
      variables: ['title', 'content'],
    };
  }

  /**
   * Render template
   */
  private renderTemplate(
    template: NotificationTemplate,
    variables: Record<string, unknown>
  ): { subject: string; html: string; text: string } {
    let subject = template.subject;
    let html = template.htmlTemplate;
    let text = template.textTemplate;

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      const valueStr = String(value);
      subject = subject.replace(new RegExp(placeholder, 'g'), valueStr);
      html = html.replace(new RegExp(placeholder, 'g'), valueStr);
      text = text.replace(new RegExp(placeholder, 'g'), valueStr);
    }

    return { subject, html, text };
  }

  /**
   * Collect digest items
   */
  private async collectDigestItems(tenantId: TenantId): Promise<Array<{
    type: string;
    title: string;
    message: string;
    actionUrl?: string;
  }>> {
    const items: Array<{ type: string; title: string; message: string; actionUrl?: string }> = [];

    // Get unprocessed documents
    const unprocessedDocs = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM documents
       WHERE tenant_id = $1 AND status NOT IN ('posted', 'error')
       AND created_at > NOW() - INTERVAL '24 hours'`,
      [tenantId]
    );
    if (parseInt(unprocessedDocs.rows[0]?.count || '0', 10) > 0) {
      items.push({
        type: 'documents',
        title: 'New Documents',
        message: `${unprocessedDocs.rows[0]?.count} documents need processing`,
        actionUrl: '/documents',
      });
    }

    // Get unmatched transactions
    const unmatchedTx = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM bank_transactions
       WHERE tenant_id = $1 AND reconciled = false
       AND date >= NOW() - INTERVAL '7 days'`,
      [tenantId]
    );
    if (parseInt(unmatchedTx.rows[0]?.count || '0', 10) > 0) {
      items.push({
        type: 'reconciliation',
        title: 'Unmatched Transactions',
        message: `${unmatchedTx.rows[0]?.count} transactions need reconciliation`,
        actionUrl: '/reconciliation',
      });
    }

    // Get exceptions
    const exceptions = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM exception_queue
       WHERE tenant_id = $1 AND status = 'pending'`,
      [tenantId]
    );
    if (parseInt(exceptions.rows[0]?.count || '0', 10) > 0) {
      items.push({
        type: 'exceptions',
        title: 'Review Required',
        message: `${exceptions.rows[0]?.count} items need your attention`,
        actionUrl: '/exceptions',
      });
    }

    return items;
  }

  /**
   * Format digest content
   */
  private formatDigestContent(items: Array<{ type: string; title: string; message: string }>): string {
    return items.map(item => `• ${item.title}: ${item.message}`).join('\n');
  }

  /**
   * Get user email
   */
  private async getUserEmail(userIdOrTenantId: string): Promise<string> {
    const result = await db.query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1 OR tenant_id = $1 LIMIT 1',
      [userIdOrTenantId]
    );

    return result.rows.length > 0 ? result.rows[0].email : 'user@example.com';
  }

  /**
   * Create in-app notification
   */
  private async createInAppNotification(
    tenantId: TenantId,
    userId: UserId | null,
    title: string,
    message: string
  ): Promise<void> {
    await db.query(
      `INSERT INTO notifications (
        id, tenant_id, user_id, type, title, message, read, created_at
      ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, false, NOW())`,
      [tenantId, userId, 'info', title, message]
    );
  }
}

export const enhancedNotificationService = new EnhancedNotificationService();
