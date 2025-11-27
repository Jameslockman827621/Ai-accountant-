import { db } from '@ai-accountant/database';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { SupportTicket, assignTicket, createTicket, getTicket } from './tickets';
import { requestAssistantResponse } from './assistantResponder';
import { searchKnowledgeArticles, KnowledgeArticle } from '@ai-accountant/shared-utils';

const logger = createLogger('support-service');

export interface SlaPolicy {
  id: string;
  tenantId: TenantId;
  name: string;
  priority: SupportTicket['priority'];
  responseMinutes: number;
  resolutionMinutes: number;
}

export interface SupportCase extends SupportTicket {
  caseId: string;
  channel: 'chat' | 'email' | 'portal';
  customerEmail?: string | null;
  customerName?: string | null;
  slaPolicy?: SlaPolicy | null;
  responseDueAt?: Date;
  resolutionDueAt?: Date;
}

function calculateDueDates(
  createdAt: Date,
  priority: SupportTicket['priority'],
  policy?: SlaPolicy
): { responseDueAt: Date; resolutionDueAt: Date } {
  const defaultResponse = priority === 'urgent' ? 15 : priority === 'high' ? 60 : 180;
  const defaultResolution = priority === 'urgent' ? 240 : priority === 'high' ? 720 : 1440;

  const responseMinutes = policy?.responseMinutes ?? defaultResponse;
  const resolutionMinutes = policy?.resolutionMinutes ?? defaultResolution;

  const responseDueAt = new Date(createdAt.getTime() + responseMinutes * 60 * 1000);
  const resolutionDueAt = new Date(createdAt.getTime() + resolutionMinutes * 60 * 1000);

  return { responseDueAt, resolutionDueAt };
}

export async function upsertSlaPolicy(
  tenantId: TenantId,
  name: string,
  priority: SupportTicket['priority'],
  responseMinutes: number,
  resolutionMinutes: number
): Promise<string> {
  const policyId = randomUUID();

  await db.query(
    `INSERT INTO support_sla_policies (id, tenant_id, name, priority, response_minutes, resolution_minutes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, name, priority)
     DO UPDATE SET response_minutes = EXCLUDED.response_minutes, resolution_minutes = EXCLUDED.resolution_minutes`,
    [policyId, tenantId, name, priority, responseMinutes, resolutionMinutes]
  );

  logger.info('SLA policy saved', { policyId, tenantId, name, priority });
  return policyId;
}

export async function listSlaPolicies(tenantId: TenantId): Promise<SlaPolicy[]> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    name: string;
    priority: string;
    response_minutes: number;
    resolution_minutes: number;
  }>(
    `SELECT id, tenant_id, name, priority, response_minutes, resolution_minutes
     FROM support_sla_policies
     WHERE tenant_id = $1
     ORDER BY priority DESC, name ASC`,
    [tenantId]
  );

  return result.rows.map(row => ({
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    name: row.name,
    priority: row.priority as SupportTicket['priority'],
    responseMinutes: row.response_minutes,
    resolutionMinutes: row.resolution_minutes,
  }));
}

export async function createCase(
  tenantId: TenantId,
  userId: UserId,
  params: {
    subject: string;
    description: string;
    priority: SupportTicket['priority'];
    channel: SupportCase['channel'];
    customerEmail?: string;
    customerName?: string;
    slaPolicyId?: string;
  }
): Promise<string> {
  if (!params.subject || !params.description) {
    throw new ValidationError('subject and description are required');
  }

  const ticketId = await createTicket(
    tenantId,
    userId,
    params.subject,
    params.description,
    params.priority
  );

  const caseId = randomUUID();

  await db.query(
    `INSERT INTO support_cases (id, ticket_id, tenant_id, channel, customer_email, customer_name, sla_policy_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      caseId,
      ticketId,
      tenantId,
      params.channel,
      params.customerEmail || null,
      params.customerName || null,
      params.slaPolicyId || null,
    ]
  );

  logger.info('Support case created', { caseId, ticketId, tenantId, channel: params.channel });
  return caseId;
}

export async function getCases(
  tenantId: TenantId,
  status?: SupportTicket['status']
): Promise<SupportCase[]> {
  const statusClause = status ? 'AND t.status = $2' : '';
  const params: unknown[] = status ? [tenantId, status] : [tenantId];

  const result = await db.query<{
    case_id: string;
    ticket_id: string;
    tenant_id: string;
    channel: string;
    customer_email: string | null;
    customer_name: string | null;
    sla_policy_id: string | null;
    created_at: Date;
    id: string;
    user_id: string;
    subject: string;
    description: string;
    status: string;
    priority: string;
    assigned_to: string | null;
    resolution: string | null;
    ticket_created_at: Date;
    ticket_updated_at: Date;
    response_minutes: number | null;
    resolution_minutes: number | null;
    policy_name: string | null;
  }>(
    `SELECT c.id as case_id, c.ticket_id, c.tenant_id, c.channel, c.customer_email, c.customer_name, c.sla_policy_id, c.created_at,
            t.id, t.user_id, t.subject, t.description, t.status, t.priority, t.assigned_to, t.resolution, t.created_at as ticket_created_at, t.updated_at as ticket_updated_at,
            p.response_minutes, p.resolution_minutes, p.name as policy_name
     FROM support_cases c
     JOIN support_tickets t ON c.ticket_id = t.id
     LEFT JOIN support_sla_policies p ON c.sla_policy_id = p.id
     WHERE c.tenant_id = $1 ${statusClause}
     ORDER BY t.created_at DESC
     LIMIT 100`,
    params
  );

  return result.rows.map(row => {
    const policy = row.sla_policy_id
      ? {
          id: row.sla_policy_id,
          tenantId: row.tenant_id as TenantId,
          name: row.policy_name || 'Custom SLA',
          priority: row.priority as SupportTicket['priority'],
          responseMinutes: row.response_minutes || 60,
          resolutionMinutes: row.resolution_minutes || 720,
        }
      : undefined;

    const { responseDueAt, resolutionDueAt } = calculateDueDates(
      row.ticket_created_at,
      row.priority as SupportTicket['priority'],
      policy
    );

    return {
      caseId: row.case_id,
      id: row.ticket_id,
      tenantId: row.tenant_id as TenantId,
      userId: row.user_id as UserId,
      subject: row.subject,
      description: row.description,
      status: row.status as SupportTicket['status'],
      priority: row.priority as SupportTicket['priority'],
      assignedTo: row.assigned_to,
      resolution: row.resolution,
      createdAt: row.ticket_created_at,
      updatedAt: row.ticket_updated_at,
      channel: row.channel as SupportCase['channel'],
      customerEmail: row.customer_email,
      customerName: row.customer_name,
      slaPolicy: policy || null,
      responseDueAt,
      resolutionDueAt,
    };
  });
}

export async function assignCase(caseId: string, tenantId: TenantId, userId: UserId): Promise<void> {
  const ticketResult = await db.query<{ ticket_id: string }>(
    'SELECT ticket_id FROM support_cases WHERE id = $1 AND tenant_id = $2',
    [caseId, tenantId]
  );

  if (ticketResult.rows.length === 0) {
    throw new ValidationError('Case not found');
  }

  const ticketRow = ticketResult.rows[0];
  if (!ticketRow) {
    throw new ValidationError('Case not found');
  }

  await assignTicket(ticketRow.ticket_id, tenantId, userId);
  logger.info('Case assigned', { caseId, tenantId, userId });
}

export async function attachSlaToCase(
  caseId: string,
  tenantId: TenantId,
  slaPolicyId: string
): Promise<void> {
  await db.query(
    `UPDATE support_cases
     SET sla_policy_id = $1
     WHERE id = $2 AND tenant_id = $3`,
    [slaPolicyId, caseId, tenantId]
  );
  logger.info('SLA attached to case', { caseId, tenantId, slaPolicyId });
}

export async function getCaseAiResponse(
  caseId: string,
  tenantId: TenantId,
  requestingUserId: UserId
): Promise<{
  response: string;
  citations: string[];
  suggestedArticles: KnowledgeArticle[];
}> {
  const caseResult = await db.query<{ ticket_id: string; subject: string; description: string }>(
    `SELECT c.ticket_id, t.subject, t.description
     FROM support_cases c
     JOIN support_tickets t ON c.ticket_id = t.id
     WHERE c.id = $1 AND c.tenant_id = $2`,
    [caseId, tenantId]
  );

  if (caseResult.rows.length === 0) {
    throw new ValidationError('Case not found');
  }

  const caseRow = caseResult.rows[0];
  if (!caseRow) {
    throw new ValidationError('Case not found');
  }

  const { ticket_id: ticketId, subject, description } = caseRow;
  const ticket = await getTicket(ticketId, tenantId);

  if (!ticket) {
    throw new ValidationError('Ticket details missing for case');
  }

  const knowledgeHits = searchKnowledgeArticles(subject + ' ' + description, { limit: 3 });

  const prompt = `You are a support agent. Provide a concise response for the following case and next best actions. Subject: ${subject}. Description: ${description}. Current status: ${ticket.status}. Priority: ${ticket.priority}.`;
  const assistant = await requestAssistantResponse(tenantId, requestingUserId, prompt, caseId);

  return {
    response: assistant.answer,
    citations: assistant.citations || [],
    suggestedArticles: knowledgeHits,
  };
}
