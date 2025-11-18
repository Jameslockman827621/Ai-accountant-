import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('support-service');

export interface SupportTicket {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  subject: string;
  description: string;
  category: 'technical' | 'billing' | 'feature_request' | 'bug' | 'other';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  assignedTo?: UserId;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  messages: Array<{
    id: string;
    userId: UserId;
    message: string;
    isInternal: boolean;
    createdAt: Date;
  }>;
}

/**
 * Complete ticket lifecycle management
 */
export async function createTicket(
  tenantId: TenantId,
  userId: UserId,
  subject: string,
  description: string,
  category: SupportTicket['category'],
  priority: SupportTicket['priority'] = 'medium'
): Promise<string> {
  const ticketId = randomUUID();

  await db.query(
    `INSERT INTO support_tickets (
      id, tenant_id, user_id, subject, description, category, priority,
      status, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', NOW(), NOW())`,
    [ticketId, tenantId, userId, subject, description, category, priority]
  );

  // Add initial message
  await db.query(
    `INSERT INTO support_ticket_messages (
      id, ticket_id, user_id, message, is_internal, created_at
    ) VALUES (gen_random_uuid(), $1, $2, $3, false, NOW())`,
    [ticketId, userId, description]
  );

  logger.info('Support ticket created', { ticketId, tenantId, userId, category, priority });

  return ticketId;
}

/**
 * Get tickets for a tenant
 */
export async function getTickets(
  tenantId: TenantId,
  status?: SupportTicket['status'],
  limit = 50
): Promise<SupportTicket[]> {
  let query = `SELECT 
     t.id, t.tenant_id, t.user_id, t.subject, t.description,
     t.category, t.priority, t.status, t.assigned_to,
     t.created_at, t.updated_at, t.resolved_at
   FROM support_tickets t
   WHERE t.tenant_id = $1`;

  const params: unknown[] = [tenantId];

  if (status) {
    query += ' AND t.status = $2';
    params.push(status);
  }

  query += ' ORDER BY t.created_at DESC LIMIT $' + (params.length + 1);
  params.push(limit);

  const result = await db.query<{
    id: string;
    tenant_id: string;
    user_id: string;
    subject: string;
    description: string;
    category: string;
    priority: string;
    status: string;
    assigned_to: string | null;
    created_at: Date;
    updated_at: Date;
    resolved_at: Date | null;
  }>(query, params);

  // Get messages for each ticket
  const tickets: SupportTicket[] = [];

    for (const row of result.rows) {
      const messagesResult = await db.query<{
      id: string;
      user_id: string;
      message: string;
      is_internal: boolean;
      created_at: Date;
    }>(
      `SELECT id, user_id, message, is_internal, created_at
       FROM support_ticket_messages
       WHERE ticket_id = $1
       ORDER BY created_at ASC`,
      [row.id]
    );

      const ticket: SupportTicket = {
        id: row.id,
        tenantId: row.tenant_id as TenantId,
        userId: row.user_id as UserId,
        subject: row.subject,
        description: row.description,
        category: row.category as SupportTicket['category'],
        priority: row.priority as SupportTicket['priority'],
        status: row.status as SupportTicket['status'],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        messages: messagesResult.rows.map(msg => ({
          id: msg.id,
          userId: msg.user_id as UserId,
          message: msg.message,
          isInternal: msg.is_internal,
          createdAt: msg.created_at,
        })),
      };

      if (row.resolved_at) {
        ticket.resolvedAt = row.resolved_at;
      }

      if (row.assigned_to) {
        ticket.assignedTo = row.assigned_to as UserId;
      }

      tickets.push(ticket);
  }

  return tickets;
}

/**
 * Add message to ticket
 */
export async function addTicketMessage(
  ticketId: string,
  tenantId: TenantId,
  userId: UserId,
  message: string,
  isInternal: boolean = false
): Promise<void> {
  await db.query(
    `INSERT INTO support_ticket_messages (
      id, ticket_id, user_id, message, is_internal, created_at
    ) VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
    [ticketId, userId, message, isInternal]
  );

  // Update ticket updated_at
  await db.query(
    `UPDATE support_tickets
     SET updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [ticketId, tenantId]
  );

  logger.info('Ticket message added', { ticketId, userId, isInternal });
}

/**
 * Update ticket status
 */
export async function updateTicketStatus(
  ticketId: string,
  tenantId: TenantId,
  status: SupportTicket['status'],
  assignedTo?: UserId
): Promise<void> {
  const updates: string[] = ['status = $1', 'updated_at = NOW()'];
  const params: unknown[] = [status, ticketId, tenantId];

  if (assignedTo) {
    updates.push('assigned_to = $' + (params.length + 1));
    params.splice(params.length - 2, 0, assignedTo);
  }

  if (status === 'resolved' || status === 'closed') {
    updates.push('resolved_at = NOW()');
  }

  await db.query(
    `UPDATE support_tickets
     SET ${updates.join(', ')}
     WHERE id = $${params.length - 1} AND tenant_id = $${params.length}`,
    params
  );

  logger.info('Ticket status updated', { ticketId, status, assignedTo });
}
