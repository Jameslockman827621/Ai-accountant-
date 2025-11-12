import OpenAI from 'openai';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { AssistantResponse, Citation, TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('assistant-service');

import { ChromaClient } from 'chromadb';

const chromaClient = new ChromaClient({
  path: process.env.CHROMA_URL || 'http://localhost:8000',
});

const COLLECTION_NAME = 'accounting-knowledge';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL_VERSION = process.env.OPENAI_MODEL || 'gpt-4';

export async function queryAssistant(
  tenantId: TenantId,
  question: string
): Promise<AssistantResponse> {
  try {
    // Get relevant context from vector database
    const context = await retrieveContext(tenantId, question);

    // Build prompt with context
    const prompt = buildPrompt(question, context);

    // Query LLM
    const completion = await openai.chat.completions.create({
      model: MODEL_VERSION,
      messages: [
        {
          role: 'system',
          content: 'You are an expert AI accountant assistant. Provide accurate, helpful answers about accounting, tax, and financial matters. Always cite your sources.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
    });

    const answer = completion.choices[0]?.message?.content || 'I could not generate an answer.';

    // Extract citations from context
    const citations: Citation[] = context.map((item) => ({
      type: item.type as 'rule' | 'document' | 'ledger',
      id: item.id,
      reference: item.reference,
    }));

    // Calculate confidence (simplified - in production, use more sophisticated scoring)
    const confidenceScore = Math.min(0.95, 0.7 + context.length * 0.05);

    // Determine suggested action
    const suggestedAction = determineSuggestedAction(question, answer);

    const response: AssistantResponse = {
      answer,
      confidenceScore,
      citations,
      modelVersion: MODEL_VERSION,
      promptTemplate: 'rag-with-context',
    };
    
    if (suggestedAction) {
      response.suggestedAction = suggestedAction;
    }
    
    return response;
  } catch (error) {
    logger.error('Assistant query failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

async function retrieveContext(
  tenantId: TenantId,
  question: string
): Promise<Array<{ type: string; id: string; reference: string; content: string }>> {
  try {
    // Generate query embedding
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: question,
    });

    const queryEmbedding = embeddingResponse.data[0]?.embedding;

    if (!queryEmbedding) {
      throw new Error('Failed to generate embedding');
    }

    // Get or create collection
    const collection = await chromaClient.getOrCreateCollection({
      name: COLLECTION_NAME,
    });

    // Search similar documents
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: 5,
      where: { tenantId: { $eq: tenantId } },
    });

    const context: Array<{ type: string; id: string; reference: string; content: string }> = [];

    if (results.ids && results.ids[0]) {
      for (let i = 0; i < results.ids[0].length; i++) {
        const id = results.ids[0]?.[i];
        const metadata = results.metadatas?.[0]?.[i] as Record<string, unknown> | undefined;
        const document = results.documents?.[0]?.[i];

        if (id && metadata && document) {
          context.push({
            type: (metadata.type as string) || 'document',
            id: (metadata.id as string) || id,
            reference: (metadata.reference as string) || id,
            content: document,
          });
        }
      }
    }

    // Also get recent ledger entries and documents from database
    const ledgerEntries = await db.query<{
      id: string;
      description: string;
      amount: number;
      transaction_date: Date;
    }>(
      `SELECT id, description, amount, transaction_date
       FROM ledger_entries
       WHERE tenant_id = $1
       ORDER BY transaction_date DESC
       LIMIT 10`,
      [tenantId]
    );

    for (const entry of ledgerEntries.rows) {
      context.push({
        type: 'ledger',
        id: entry.id,
        reference: `Ledger Entry ${entry.id.substring(0, 8)}`,
        content: `${entry.description} - ${entry.amount} on ${entry.transaction_date}`,
      });
    }

    return context;
  } catch (error) {
    logger.error('Context retrieval failed', error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}

function buildPrompt(question: string, context: Array<{ content: string; reference: string }>): string {
  const contextText = context
    .map((item, index) => `[${index + 1}] ${item.reference}: ${item.content}`)
    .join('\n\n');

  return `Answer the following question about accounting/tax matters using the provided context.

Context:
${contextText}

Question: ${question}

Instructions:
- Provide a clear, accurate answer
- Cite sources using [1], [2], etc. format
- If the context doesn't contain enough information, say so
- Be concise but thorough
- If asked about calculations, show your work`;
}

function determineSuggestedAction(question: string, answer: string): string | undefined {
  const lowerQuestion = question.toLowerCase();
  const lowerAnswer = answer.toLowerCase();

  if (lowerQuestion.includes('vat') || lowerAnswer.includes('vat')) {
    return 'View VAT return or Generate VAT filing';
  }
  if (lowerQuestion.includes('expense') || lowerQuestion.includes('receipt')) {
    return 'View expenses or Upload receipt';
  }
  if (lowerQuestion.includes('profit') || lowerQuestion.includes('loss')) {
    return 'View P&L statement';
  }
  if (lowerQuestion.includes('cash flow') || lowerQuestion.includes('cashflow')) {
    return 'View cash flow report';
  }
  return undefined;
}

export async function indexDocument(
  tenantId: TenantId,
  documentId: string,
  content: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    // Generate embedding
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: content,
    });

    const embedding = embeddingResponse.data[0]?.embedding;

    if (!embedding) {
      throw new Error('Failed to generate embedding');
    }

    // Get or create collection
    const collection = await chromaClient.getOrCreateCollection({
      name: COLLECTION_NAME,
    });

    // Add to collection
    await collection.add({
      ids: [`doc-${tenantId}-${documentId}`],
      embeddings: [embedding],
      documents: [content],
      metadatas: [
        {
          tenantId,
          documentId,
          type: 'document',
          id: documentId,
          reference: `Document ${documentId.substring(0, 8)}`,
          ...metadata,
        },
      ],
    });

    logger.info('Document indexed', { tenantId, documentId });
  } catch (error) {
    logger.error('Document indexing failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
