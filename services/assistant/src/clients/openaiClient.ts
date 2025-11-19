import OpenAI from 'openai';
import { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import {
  createServiceLogger,
  recordLLMError,
  recordLLMRequest,
  withExponentialBackoff,
} from '@ai-accountant/observability';

const logger = createServiceLogger('assistant-service');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function runChatCompletion(
  params: ChatCompletionCreateParams
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const start = Date.now();

  try {
    const completion = await withExponentialBackoff(() => openai.chat.completions.create(params), {
      maxAttempts: 3,
      baseDelayMs: 300,
      onRetry: (attempt, error) => {
        logger.warn('OpenAI chat completion retry', {
          attempt,
          error: error instanceof Error ? error.message : String(error),
          model: params.model,
        });
      },
    });

    const duration = Date.now() - start;
    const usage = completion.usage;
    recordLLMRequest({
      service: 'assistant-service',
      model: params.model,
      durationMs: duration,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      totalTokens: usage?.total_tokens,
    });

    return completion;
  } catch (error) {
    recordLLMError('assistant-service', params.model);
    throw error instanceof Error ? error : new Error(String(error));
  }
}
