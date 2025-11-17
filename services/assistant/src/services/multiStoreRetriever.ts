/**
 * Multi-Store Retriever Service
 * Combines structured Postgres queries, vector store (Chroma), and rulepack metadata
 * with hybrid retrieval and ranking
 */

import OpenAI from 'openai';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import { ChromaClient } from 'chromadb';
import { rulepackRegistryService } from '@ai-accountant/rules-engine-service/services/rulepackRegistry';

const logger = createLogger('multi-store-retriever');

const chromaClient = new ChromaClient({
  path: process.env.CHROMA_URL || 'http://localhost:8000',
});

const COLLECTION_NAME = 'accounting-knowledge';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface RetrievalContext {
  userId?: UserId;
  conversationId?: string;
  limit?: number;
  periodStart?: Date;
  periodEnd?: Date;
  role?: 'accountant' | 'client' | 'viewer';
}

export interface RetrievedItem {
  type: 'document' | 'ledger' | 'rule' | 'rulepack';
  id: string;
  reference: string;
  content: string;
  score: number;
  source: 'vector' | 'structured' | 'rulepack';
}

export class MultiStoreRetriever {
  /**
   * Retrieve context from multiple stores with hybrid ranking
   */
  async retrieve(
    tenantId: TenantId,
    question: string,
    context: RetrievalContext = {}
  ): Promise<RetrievedItem[]> {
    const limit = context.limit || 10;

    // Retrieve from all stores in parallel
    const [vectorResults, structuredResults, rulepackResults] = await Promise.all([
      this.retrieveFromVectorStore(tenantId, question, limit * 2),
      this.retrieveFromStructuredStore(tenantId, question, context, limit * 2),
      this.retrieveFromRulepackStore(tenantId, question, limit),
    ]);

    // Combine and rank results
    const allResults = [...vectorResults, ...structuredResults, ...rulepackResults];

    // Deduplicate by ID
    const seen = new Set<string>();
    const uniqueResults: RetrievedItem[] = [];

    for (const result of allResults) {
      const key = `${result.type}:${result.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueResults.push(result);
      }
    }

    // Re-rank using hybrid scoring
    const rankedResults = this.hybridRank(uniqueResults, question);

    // Return top N results
    return rankedResults.slice(0, limit);
  }

  /**
   * Retrieve from vector store (Chroma)
   */
  private async retrieveFromVectorStore(
    tenantId: TenantId,
    question: string,
    limit: number
  ): Promise<RetrievedItem[]> {
    try {
      // Generate query embedding
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: question,
      });

      const queryEmbedding = embeddingResponse.data[0]?.embedding;
      if (!queryEmbedding) {
        return [];
      }

      // Get or create collection
      const collection = await chromaClient.getOrCreateCollection({
        name: COLLECTION_NAME,
      });

      // Search similar documents
      const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: limit,
        where: { tenantId: { $eq: tenantId } },
      });

      const items: RetrievedItem[] = [];

      if (results.ids && results.ids[0]) {
        for (let i = 0; i < results.ids[0].length; i++) {
          const id = results.ids[0]?.[i];
          const metadata = results.metadatas?.[0]?.[i] as Record<string, unknown> | undefined;
          const document = results.documents?.[0]?.[i];
          const distance = results.distances?.[0]?.[i];

          if (id && metadata && document) {
            // Convert distance to score (lower distance = higher score)
            const score = distance !== undefined ? 1 - Math.min(1, distance) : 0.5;

            items.push({
              type: (metadata.type as 'document' | 'ledger') || 'document',
              id: (metadata.id as string) || id,
              reference: (metadata.reference as string) || id,
              content: document,
              score,
              source: 'vector',
            });
          }
        }
      }

      return items;
    } catch (error) {
      logger.error('Vector store retrieval failed', error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }

  /**
   * Retrieve from structured store (Postgres)
   */
  private async retrieveFromStructuredStore(
    tenantId: TenantId,
    question: string,
    context: RetrievalContext,
    limit: number
  ): Promise<RetrievedItem[]> {
    const items: RetrievedItem[] = [];

    try {
      // Extract keywords from question for matching
      const keywords = this.extractKeywords(question);

      // Get recent ledger entries (with temporal context if provided)
      let ledgerQuery = `
        SELECT id, description, debit_amount, credit_amount, transaction_date, account_code, account_name
        FROM ledger_entries
        WHERE tenant_id = $1
      `;
      const ledgerParams: unknown[] = [tenantId];

      if (context.periodStart && context.periodEnd) {
        ledgerQuery += ` AND transaction_date BETWEEN $2 AND $3`;
        ledgerParams.push(context.periodStart, context.periodEnd);
      } else {
        // Default to last 90 days
        const defaultEnd = new Date();
        const defaultStart = new Date(defaultEnd.getTime() - 90 * 24 * 60 * 60 * 1000);
        ledgerQuery += ` AND transaction_date BETWEEN $2 AND $3`;
        ledgerParams.push(defaultStart, defaultEnd);
      }

      // Add keyword matching if available
      if (keywords.length > 0) {
        const keywordConditions = keywords
          .map((_, idx) => `(description ILIKE $${ledgerParams.length + idx + 1} OR account_name ILIKE $${ledgerParams.length + idx + 1})`)
          .join(' OR ');
        ledgerQuery += ` AND (${keywordConditions})`;
        keywords.forEach(keyword => {
          ledgerParams.push(`%${keyword}%`);
        });
      }

      ledgerQuery += ` ORDER BY transaction_date DESC LIMIT $${ledgerParams.length + 1}`;
      ledgerParams.push(limit);

      const ledgerResult = await db.query(ledgerQuery, ledgerParams);

      for (const row of ledgerResult.rows) {
        const amount = Number(row.debit_amount || row.credit_amount || 0);
        const content = `${row.description} - ${row.account_name} (${row.account_code}): ${amount} on ${row.transaction_date}`;

        // Calculate relevance score based on keyword matches
        const relevanceScore = this.calculateRelevanceScore(question, content, keywords);

        items.push({
          type: 'ledger',
          id: row.id,
          reference: `Ledger Entry ${row.id.substring(0, 8)}`,
          content,
          score: relevanceScore,
          source: 'structured',
        });
      }

      // Get recent documents
      const docQuery = `
        SELECT id, file_name, document_type, extracted_data
        FROM documents
        WHERE tenant_id = $1
          AND status = 'posted'
        ORDER BY created_at DESC
        LIMIT $2
      `;
      const docResult = await db.query(docQuery, [tenantId, Math.floor(limit / 2)]);

      for (const row of docResult.rows) {
        const extractedData = (row.extracted_data as Record<string, unknown>) || {};
        const content = JSON.stringify(extractedData).substring(0, 500);

        const relevanceScore = this.calculateRelevanceScore(question, content, keywords);

        items.push({
          type: 'document',
          id: row.id,
          reference: `Document: ${row.file_name}`,
          content,
          score: relevanceScore,
          source: 'structured',
        });
      }
    } catch (error) {
      logger.error('Structured store retrieval failed', error instanceof Error ? error : new Error(String(error)));
    }

    return items;
  }

  /**
   * Retrieve from rulepack store
   */
  private async retrieveFromRulepackStore(
    tenantId: TenantId,
    question: string,
    limit: number
  ): Promise<RetrievedItem[]> {
    const items: RetrievedItem[] = [];

    try {
      // Get tenant jurisdiction
      const tenantResult = await db.query<{ jurisdiction: string }>(
        `SELECT jurisdiction FROM intent_profiles WHERE tenant_id = $1 LIMIT 1`,
        [tenantId]
      );

      if (tenantResult.rows.length === 0) {
        return items;
      }

      const jurisdiction = tenantResult.rows[0].jurisdiction;

      // Get active rulepack
      const rulepack = await rulepackRegistryService.getActiveRulepack(jurisdiction);
      if (!rulepack) {
        return items;
      }

      // Extract tax-related keywords
      const taxKeywords = ['vat', 'tax', 'filing', 'return', 'liability', 'deduction', 'credit'];
      const questionLower = question.toLowerCase();
      const hasTaxKeywords = taxKeywords.some(keyword => questionLower.includes(keyword));

      if (hasTaxKeywords) {
        // Get relevant rules from rulepack
        const rules = (rulepack.rulepackData.rules as Array<{
          id: string;
          name: string;
          description: string;
          condition?: string;
        }>) || [];

        // Match rules based on keywords
        const keywords = this.extractKeywords(question);
        const matchedRules = rules
          .filter(rule => {
            const ruleText = `${rule.name} ${rule.description} ${rule.condition || ''}`.toLowerCase();
            return keywords.some(keyword => ruleText.includes(keyword.toLowerCase()));
          })
          .slice(0, limit);

        for (const rule of matchedRules) {
          items.push({
            type: 'rule',
            id: rule.id,
            reference: `Rule: ${rule.name}`,
            content: `${rule.description}${rule.condition ? ` (Condition: ${rule.condition})` : ''}`,
            score: 0.8, // High score for rule matches
            source: 'rulepack',
          });
        }

        // Add rulepack metadata
        items.push({
          type: 'rulepack',
          id: rulepack.id,
          reference: `Rulepack: ${jurisdiction} v${rulepack.version}`,
          content: `Active rulepack for ${jurisdiction}, version ${rulepack.version}`,
          score: 0.7,
          source: 'rulepack',
        });
      }
    } catch (error) {
      logger.error('Rulepack retrieval failed', error instanceof Error ? error : new Error(String(error)));
    }

    return items;
  }

  /**
   * Hybrid ranking combining scores from different sources
   */
  private hybridRank(items: RetrievedItem[], question: string): RetrievedItem[] {
    // Boost scores based on source type and relevance
    const boosted = items.map(item => {
      let boostedScore = item.score;

      // Boost vector store results (semantic similarity)
      if (item.source === 'vector') {
        boostedScore *= 1.2;
      }

      // Boost rule matches for tax questions
      if (item.type === 'rule' && this.isTaxQuestion(question)) {
        boostedScore *= 1.3;
      }

      // Boost recent ledger entries
      if (item.type === 'ledger' && item.source === 'structured') {
        boostedScore *= 1.1;
      }

      return { ...item, score: Math.min(1.0, boostedScore) };
    });

    // Sort by boosted score
    return boosted.sort((a, b) => b.score - a.score);
  }

  /**
   * Extract keywords from question
   */
  private extractKeywords(text: string): string[] {
    // Simple keyword extraction (in production, use NLP)
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'was', 'were']);
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.has(word));

    return [...new Set(words)]; // Remove duplicates
  }

  /**
   * Calculate relevance score based on keyword matches
   */
  private calculateRelevanceScore(text: string, content: string, keywords: string[]): number {
    if (keywords.length === 0) {
      return 0.5; // Default score
    }

    const contentLower = content.toLowerCase();
    const matches = keywords.filter(keyword => contentLower.includes(keyword.toLowerCase())).length;
    return Math.min(1.0, 0.3 + (matches / keywords.length) * 0.7);
  }

  /**
   * Check if question is tax-related
   */
  private isTaxQuestion(question: string): boolean {
    const taxKeywords = ['vat', 'tax', 'filing', 'return', 'liability', 'deduction', 'credit', 'hmrc', 'irs'];
    const questionLower = question.toLowerCase();
    return taxKeywords.some(keyword => questionLower.includes(keyword));
  }
}

export const multiStoreRetriever = new MultiStoreRetriever();
