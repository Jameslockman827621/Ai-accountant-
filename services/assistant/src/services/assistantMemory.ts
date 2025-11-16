import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { rulepackRegistryService } from '@ai-accountant/rules-engine-service/services/rulepackRegistry';

const logger = createLogger('assistant-memory');

export interface ConversationMemory {
  id: string;
  tenantId: TenantId;
  userId: UserId | null;
  conversationId: string;
  context: Record<string, unknown>;
  rulepackVersions: Record<string, string>; // {jurisdiction: version}
  documentCitations: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Assistant Memory Service (Chunk 3)
 * Stores conversation context with rulepack versions and document citations
 */
export class AssistantMemoryService {
  /**
   * Get or create conversation memory
   */
  async getOrCreateMemory(
    tenantId: TenantId,
    userId: UserId | null,
    conversationId: string
  ): Promise<ConversationMemory> {
    const existing = await this.getMemory(conversationId);
    if (existing) {
      return existing;
    }

    // Create new memory
    const memoryId = randomUUID();
    await db.query(
      `INSERT INTO assistant_conversation_memory (
        id, tenant_id, user_id, conversation_id, context, rulepack_versions,
        document_citations, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, '{}'::jsonb, '{}'::jsonb, ARRAY[]::UUID[], NOW(), NOW()
      )`,
      [memoryId, tenantId, userId, conversationId]
    );

    return this.getMemory(conversationId) as Promise<ConversationMemory>;
  }

  /**
   * Get conversation memory
   */
  async getMemory(conversationId: string): Promise<ConversationMemory | null> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      user_id: string | null;
      conversation_id: string;
      context: unknown;
      rulepack_versions: unknown;
      document_citations: string[];
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT * FROM assistant_conversation_memory WHERE conversation_id = $1`,
      [conversationId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      conversationId: row.conversation_id,
      context: (row.context as Record<string, unknown>) || {},
      rulepackVersions: (row.rulepack_versions as Record<string, string>) || {},
      documentCitations: row.document_citations,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Update memory with rulepack versions
   */
  async updateRulepackVersions(
    conversationId: string,
    jurisdictions: string[]
  ): Promise<void> {
    const memory = await this.getMemory(conversationId);
    if (!memory) {
      return;
    }

    const rulepackVersions: Record<string, string> = {};

    for (const jurisdiction of jurisdictions) {
      const rulepack = await rulepackRegistryService.getActiveRulepack(jurisdiction);
      if (rulepack) {
        rulepackVersions[jurisdiction] = rulepack.version;
      }
    }

    await db.query(
      `UPDATE assistant_conversation_memory
       SET rulepack_versions = $1::jsonb,
           updated_at = NOW()
       WHERE conversation_id = $2`,
      [JSON.stringify(rulepackVersions), conversationId]
    );
  }

  /**
   * Add document citation
   */
  async addDocumentCitation(
    conversationId: string,
    documentId: string
  ): Promise<void> {
    await db.query(
      `UPDATE assistant_conversation_memory
       SET document_citations = array_append(document_citations, $1::UUID),
           updated_at = NOW()
       WHERE conversation_id = $2`,
      [documentId, conversationId]
    );
  }

  /**
   * Update context
   */
  async updateContext(
    conversationId: string,
    context: Record<string, unknown>
  ): Promise<void> {
    await db.query(
      `UPDATE assistant_conversation_memory
       SET context = $1::jsonb,
           updated_at = NOW()
       WHERE conversation_id = $2`,
      [JSON.stringify(context), conversationId]
    );
  }
}

export const assistantMemoryService = new AssistantMemoryService();
