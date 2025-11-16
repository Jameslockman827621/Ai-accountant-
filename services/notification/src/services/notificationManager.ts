import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('notification-service');

export interface Notification {
  id: string;
  tenantId: TenantId;
  userId: UserId | null; // null for tenant-wide notifications
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  read: boolean;
  action?: {
    label: string;
    url: string;
  };
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Notification manager for real-time alerts
 */
export class NotificationManager {
  /**
   * Create a notification
   */
  async createNotification(
    tenantId: TenantId,
    userId: UserId | null,
    type: Notification['type'],
    title: string,
    message: string,
    action?: { label: string; url: string },
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const notificationId = randomUUID();

    await db.query(
      `INSERT INTO notifications (
        id, tenant_id, user_id, type, title, message, action, metadata,
        read, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, false, NOW())`,
      [
        notificationId,
        tenantId,
        userId,
        type,
        title,
        message,
        JSON.stringify(action || null),
        JSON.stringify(metadata || {}),
      ]
    );

    logger.info('Notification created', { notificationId, tenantId, type });

    // In production, would trigger real-time push notification here
    // e.g., via WebSocket, Server-Sent Events, or push notification service

    return notificationId;
  }

  /**
   * Get notifications for a user
   */
  async getNotifications(
    tenantId: TenantId,
    userId: UserId | null,
    unreadOnly: boolean = false,
    limit: number = 50
  ): Promise<Notification[]> {
    let query = `SELECT 
       id, tenant_id, user_id, type, title, message, action, metadata,
       read, created_at
     FROM notifications
     WHERE tenant_id = $1`;

    const params: unknown[] = [tenantId];

    if (userId) {
      query += ' AND (user_id = $2 OR user_id IS NULL)';
      params.push(userId);
    } else {
      query += ' AND user_id IS NULL';
    }

    if (unreadOnly) {
      query += ` AND read = false`;
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await db.query<{
      id: string;
      tenant_id: string;
      user_id: string | null;
      type: string;
      title: string;
      message: string;
      action: string | null;
      metadata: string | null;
      read: boolean;
      created_at: Date;
    }>(query, params);

    return result.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id as TenantId,
      userId: row.user_id as UserId | null,
      type: row.type as Notification['type'],
      title: row.title,
      message: row.message,
      read: row.read,
      action: row.action ? JSON.parse(row.action) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    }));
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, tenantId: TenantId): Promise<void> {
    await db.query(
      `UPDATE notifications
       SET read = true, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [notificationId, tenantId]
    );

    logger.debug('Notification marked as read', { notificationId });
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(tenantId: TenantId, userId: UserId | null): Promise<void> {
    let query = `UPDATE notifications
     SET read = true, updated_at = NOW()
     WHERE tenant_id = $1 AND read = false`;

    const params: unknown[] = [tenantId];

    if (userId) {
      query += ' AND (user_id = $2 OR user_id IS NULL)';
      params.push(userId);
    } else {
      query += ' AND user_id IS NULL';
    }

    await db.query(query, params);

    logger.info('All notifications marked as read', { tenantId, userId });
  }

  /**
   * Get unread count
   */
  async getUnreadCount(tenantId: TenantId, userId: UserId | null): Promise<number> {
    let query = `SELECT COUNT(*) as count
     FROM notifications
     WHERE tenant_id = $1 AND read = false`;

    const params: unknown[] = [tenantId];

    if (userId) {
      query += ' AND (user_id = $2 OR user_id IS NULL)';
      params.push(userId);
    } else {
      query += ' AND user_id IS NULL';
    }

    const result = await db.query<{ count: number }>(query, params);
    return parseInt(String(result.rows[0]?.count || 0), 10);
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string, tenantId: TenantId): Promise<void> {
    await db.query(
      `DELETE FROM notifications
       WHERE id = $1 AND tenant_id = $2`,
      [notificationId, tenantId]
    );

    logger.debug('Notification deleted', { notificationId });
  }
}

// Singleton instance
export const notificationManager = new NotificationManager();
