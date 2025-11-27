import { createLogger } from '@ai-accountant/shared-utils';
import { searchKnowledgeArticles } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('support-service');

type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<FetchResponse>;

interface AssistantResponse {
  answer: string;
  citations?: string[];
  modelVersion?: string;
}

export async function requestAssistantResponse(
  tenantId: TenantId,
  userId: UserId,
  prompt: string,
  conversationId?: string
): Promise<AssistantResponse> {
  const assistantUrl = process.env.ASSISTANT_SERVICE_URL || 'http://assistant:3020/api/assistant';
  const fetchFn: FetchLike = (globalThis as any).fetch;

  try {
    const response = await fetchFn(`${assistantUrl}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-id': userId,
      },
      body: JSON.stringify({ question: prompt, conversationId }),
    });

    if (!response.ok) {
      logger.warn('Assistant returned non-200 response', { status: response.status });
      throw new Error('assistant request failed');
    }

    const data = (await response.json()) as { response: AssistantResponse };
    return data.response;
  } catch (error) {
    logger.error('Failed to request assistant response', error as Error);
    const relatedArticle = searchKnowledgeArticles(prompt, { limit: 1 })[0];

    return {
      answer:
        'Our assistant is temporarily unavailable. Here is a quick summary from the knowledge base: ' +
        (relatedArticle ? `${relatedArticle.title} — ${relatedArticle.content}` : 'Please try again shortly.'),
      modelVersion: 'fallback',
      citations: relatedArticle ? [relatedArticle.id] : [],
    };
  }
}
