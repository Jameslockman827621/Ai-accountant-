import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { queryAssistant } from './rag';

const logger = createLogger('assistant-service');

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface Conversation {
  id: string;
  tenantId: TenantId;
  messages: ConversationMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export async function createConversation(tenantId: TenantId): Promise<string> {
  const conversationId = crypto.randomUUID();
  
  await db.query(
    `INSERT INTO conversations (id, tenant_id, messages, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())`,
    [conversationId, tenantId, JSON.stringify([])]
  );

  logger.info('Conversation created', { conversationId, tenantId });
  return conversationId;
}

export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  const conversation = await getConversation(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const newMessage: ConversationMessage = {
    role,
    content,
    timestamp: new Date(),
  };

  conversation.messages.push(newMessage);

  await db.query(
    `UPDATE conversations
     SET messages = $1::jsonb, updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(conversation.messages), conversationId]
  );

  logger.info('Message added to conversation', { conversationId, role });
}

export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    messages: unknown;
    created_at: Date;
    updated_at: Date;
  }>(
    'SELECT id, tenant_id, messages, created_at, updated_at FROM conversations WHERE id = $1',
    [conversationId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    messages: (row.messages as ConversationMessage[]) || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getConversations(tenantId: TenantId, limit: number = 20): Promise<Conversation[]> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    messages: unknown;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, tenant_id, messages, created_at, updated_at
     FROM conversations
     WHERE tenant_id = $1
     ORDER BY updated_at DESC
     LIMIT $2`,
    [tenantId, limit]
  );

  return result.rows.map(row => ({
    id: row.id,
    tenantId: row.tenant_id,
    messages: (row.messages as ConversationMessage[]) || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function continueConversation(
  conversationId: string,
  userMessage: string
): Promise<string> {
  const conversation = await getConversation(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  // Add user message
  await addMessage(conversationId, 'user', userMessage);

  // Build context from previous messages
  const contextMessages = conversation.messages
    .slice(-10) // Last 10 messages for context
    .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
    .join('\n');

  // Query assistant with conversation context
  const response = await queryAssistant(
    conversation.tenantId,
    `Previous conversation:\n${contextMessages}\n\nUser: ${userMessage}`
  );

  // Add assistant response
  await addMessage(conversationId, 'assistant', response.answer);

  return response.answer;
}
