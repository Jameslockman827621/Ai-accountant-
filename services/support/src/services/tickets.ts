import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import crypto from 'crypto';

const logger = createLogger('support-service');

export interface SupportTicket {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo: UserId | null;
  resolution: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function createTicket(
  tenantId: TenantId,
  userId: UserId,
  subject: string,
  description: string,
  priority: SupportTicket['priority'] = 'medium'
): Promise<string> {
  const ticketId = crypto.randomUUID();

  await db.query(
    `INSERT INTO support_tickets (
      id, tenant_id, user_id, subject, description, status, priority, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, 'open', $6, NOW(), NOW())`,
    [ticketId, tenantId, userId, subject, description, priority]
  );

  logger.info('Support ticket created', { ticketId, tenantId, userId });
  return ticketId;
}

export async function getTicket(ticketId: string, tenantId: TenantId): Promise<SupportTicket | null> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    user_id: string;
    subject: string;
    description: string;
    status: string;
    priority: string;
    assigned_to: string | null;
    resolution: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    'SELECT * FROM support_tickets WHERE id = $1 AND tenant_id = $2',
    [ticketId, tenantId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    subject: row.subject,
    description: row.description,
    status: row.status as SupportTicket['status'],
    priority: row.priority as SupportTicket['priority'],
    assignedTo: row.assigned_to,
    resolution: row.resolution,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getTickets(
  tenantId: TenantId,
  userId?: UserId,
  status?: SupportTicket['status']
): Promise<SupportTicket[]> {
  let query = 'SELECT * FROM support_tickets WHERE tenant_id = $1';
  const params: unknown[] = [tenantId];
  let paramCount = 2;

  if (userId) {
    query += ` AND user_id = $${paramCount++}`;
    params.push(userId);
  }

  if (status) {
    query += ` AND status = $${paramCount++}`;
    params.push(status);
  }

  query += ' ORDER BY created_at DESC';

  const result = await db.query<{
    id: string;
    tenant_id: string;
    user_id: string;
    subject: string;
    description: string;
    status: string;
    priority: string;
    assigned_to: string | null;
    resolution: string | null;
    created_at: Date;
    updated_at: Date;
  }>(query, params);

  return result.rows.map(row => ({
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    subject: row.subject,
    description: row.description,
    status: row.status as SupportTicket['status'],
    priority: row.priority as SupportTicket['priority'],
    assignedTo: row.assigned_to,
    resolution: row.resolution,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function updateTicketStatus(
  ticketId: string,
  tenantId: TenantId,
  status: SupportTicket['status'],
  resolution?: string
): Promise<void> {
  await db.query(
    `UPDATE support_tickets
     SET status = $1,
         resolution = COALESCE($2, resolution),
         updated_at = NOW()
     WHERE id = $3 AND tenant_id = $4`,
    [status, resolution || null, ticketId, tenantId]
  );

  logger.info('Ticket status updated', { ticketId, status });
}

export async function assignTicket(
  ticketId: string,
  tenantId: TenantId,
  assignedTo: UserId
): Promise<void> {
  await db.query(
    `UPDATE support_tickets
     SET assigned_to = $1, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
    [assignedTo, ticketId, tenantId]
  );

  logger.info('Ticket assigned', { ticketId, assignedTo });
}

export async function addComment(
  ticketId: string,
  userId: UserId,
  comment: string,
  isInternal: boolean = false
): Promise<void> {
  await db.query(
    `INSERT INTO support_ticket_comments (id, ticket_id, user_id, comment, is_internal, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
    [ticketId, userId, comment, isInternal]
  );

  // Update ticket updated_at
  await db.query(
    'UPDATE support_tickets SET updated_at = NOW() WHERE id = $1',
    [ticketId]
  );

  logger.info('Comment added to ticket', { ticketId, userId });
}
