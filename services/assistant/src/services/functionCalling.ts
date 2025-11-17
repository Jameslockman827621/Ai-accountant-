/**
 * Enhanced Assistant Service with OpenAI Function Calling
 * Provides deterministic tool routing with sandbox/prod modes and rate limiting
 */

import OpenAI from 'openai';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import { randomUUID } from 'crypto';
import { toolsToOpenAIFormat, getToolDefinition, ALL_TOOLS } from './toolSchemas';
import { assistantToolsService } from './assistantTools';
import { guardrailService } from './guardrails';
import { multiStoreRetriever } from './multiStoreRetriever';

const logger = createLogger('assistant-function-calling');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL_VERSION = process.env.OPENAI_MODEL || 'gpt-4';

export interface FunctionCallResult {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  error?: string;
  requiresApproval: boolean;
  isIrreversible: boolean;
  actionId?: string;
}

export interface AssistantQueryResult {
  answer: string;
  confidenceScore: number;
  citations: Array<{ type: string; id: string; reference: string }>;
  modelVersion: string;
  toolCalls: FunctionCallResult[];
  reasoningTrace: Array<{ step: string; details: unknown }>;
  suggestedAction?: string;
}

/**
 * Query assistant with function calling support
 */
export async function queryAssistantWithTools(
  tenantId: TenantId,
  userId: UserId,
  question: string,
  conversationId?: string,
  executionMode: 'sandbox' | 'production' = 'production'
): Promise<AssistantQueryResult> {
  try {
    // Get relevant context using multi-store retriever
    const context = await multiStoreRetriever.retrieve(tenantId, question, {
      userId,
      conversationId,
      limit: 10,
    });

    // Build system prompt with context
    const systemPrompt = buildSystemPrompt(context);

    // Check guardrails before processing
    const guardrailCheck = await guardrailService.checkPrompt(tenantId, question);
    if (!guardrailCheck.allowed) {
      throw new Error(`Guardrail violation: ${guardrailCheck.reason}`);
    }

    // Build messages
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: question,
      },
    ];

    // Query LLM with function calling
    const completion = await openai.chat.completions.create({
      model: MODEL_VERSION,
      messages,
      tools: toolsToOpenAIFormat(),
      tool_choice: 'auto',
      temperature: 0.3,
      max_tokens: 2000,
    });

    const assistantMessage = completion.choices[0]?.message;
    if (!assistantMessage) {
      throw new Error('No response from assistant');
    }

    const reasoningTrace: Array<{ step: string; details: unknown }> = [];
    const toolCalls: FunctionCallResult[] = [];
    let finalAnswer = assistantMessage.content || '';

    // Process tool calls if any
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      reasoningTrace.push({
        step: 'tool_calls_detected',
        details: { count: assistantMessage.tool_calls.length },
      });

      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        const toolDef = getToolDefinition(toolName);

        if (!toolDef) {
          logger.warn(`Unknown tool: ${toolName}`);
          continue;
        }

        // Check rate limits
        const rateLimitCheck = await checkRateLimit(tenantId, toolDef);
        if (!rateLimitCheck.allowed) {
          toolCalls.push({
            toolName,
            args: JSON.parse(toolCall.function.arguments || '{}'),
            result: null,
            error: `Rate limit exceeded: ${rateLimitCheck.reason}`,
            requiresApproval: toolDef.requiresApproval,
            isIrreversible: toolDef.isIrreversible,
          });
          continue;
        }

        // Check guardrails for tool
        const toolGuardrailCheck = await guardrailService.checkToolCall(
          tenantId,
          toolName,
          JSON.parse(toolCall.function.arguments || '{}')
        );
        if (!toolGuardrailCheck.allowed) {
          toolCalls.push({
            toolName,
            args: JSON.parse(toolCall.function.arguments || '{}'),
            result: null,
            error: `Guardrail violation: ${toolGuardrailCheck.reason}`,
            requiresApproval: toolDef.requiresApproval,
            isIrreversible: toolDef.isIrreversible,
          });
          continue;
        }

        // Execute tool
        let toolResult: unknown;
        let toolError: string | undefined;
        const actionId = randomUUID();

        try {
          // Persist action before execution
          await persistAction({
            id: actionId,
            tenantId,
            userId,
            conversationId,
            toolName,
            toolArgs: JSON.parse(toolCall.function.arguments || '{}'),
            status: 'executing',
            requiresApproval: toolDef.requiresApproval,
            isIrreversible: toolDef.isIrreversible,
            executionMode,
          });

          // Execute tool based on name
          toolResult = await executeTool(toolName, tenantId, JSON.parse(toolCall.function.arguments || '{}'));

          // Update action with result
          await updateAction(actionId, {
            status: toolDef.requiresApproval ? 'pending' : 'completed',
            toolResult,
            approvalStatus: toolDef.requiresApproval ? 'pending' : undefined,
          });

          reasoningTrace.push({
            step: 'tool_executed',
            details: { toolName, success: true },
          });
        } catch (error) {
          toolError = error instanceof Error ? error.message : String(error);
          await updateAction(actionId, {
            status: 'failed',
            toolError,
          });
          reasoningTrace.push({
            step: 'tool_failed',
            details: { toolName, error: toolError },
          });
        }

        toolCalls.push({
          toolName,
          args: JSON.parse(toolCall.function.arguments || '{}'),
          result: toolResult,
          error: toolError,
          requiresApproval: toolDef.requiresApproval,
          isIrreversible: toolDef.isIrreversible,
          actionId,
        });
      }

      // If tools were called, get final answer with tool results
      if (toolCalls.length > 0 && toolCalls.some(tc => !tc.error)) {
        const toolResultsText = toolCalls
          .filter(tc => !tc.error)
          .map(tc => `${tc.toolName}: ${JSON.stringify(tc.result)}`)
          .join('\n');

        const followUpCompletion = await openai.chat.completions.create({
          model: MODEL_VERSION,
          messages: [
            ...messages,
            assistantMessage,
            {
              role: 'tool',
              tool_call_id: toolCalls[0].toolName,
              content: toolResultsText,
            },
            {
              role: 'user',
              content: 'Please provide a final answer based on the tool results.',
            },
          ],
          temperature: 0.3,
        });

        finalAnswer = followUpCompletion.choices[0]?.message?.content || finalAnswer;
      }
    }

    // Check guardrails on response
    const responseGuardrailCheck = await guardrailService.checkResponse(tenantId, finalAnswer);
    if (!responseGuardrailCheck.allowed) {
      finalAnswer = `I cannot provide that information due to compliance restrictions: ${responseGuardrailCheck.reason}`;
    }

    // Extract citations from context
    const citations = context.map(item => ({
      type: item.type as 'rule' | 'document' | 'ledger',
      id: item.id,
      reference: item.reference,
    }));

    // Calculate confidence
    const confidenceScore = calculateConfidence(context, toolCalls, finalAnswer);

    return {
      answer: finalAnswer,
      confidenceScore,
      citations,
      modelVersion: MODEL_VERSION,
      toolCalls,
      reasoningTrace,
    };
  } catch (error) {
    logger.error('Assistant query with tools failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Execute a tool by name
 */
async function executeTool(
  toolName: string,
  tenantId: TenantId,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case 'get_ledger_slice':
      return assistantToolsService.getLedgerSlice(
        tenantId,
        new Date(args.startDate as string),
        new Date(args.endDate as string),
        args.accountCodes as string[] | undefined
      );

    case 'calculate_tax':
      return assistantToolsService.calculateTax(tenantId, args.jurisdiction as string, {
        amount: args.amount as number,
        category: args.category as string | undefined,
        description: args.description as string | undefined,
        vendor: args.vendor as string | undefined,
      });

    case 'generate_filing_draft':
      return assistantToolsService.generateFilingDraft(
        tenantId,
        args.filingType as string,
        args.jurisdiction as string,
        new Date(args.periodStart as string),
        new Date(args.periodEnd as string)
      );

    case 'get_rule_explanation':
      return assistantToolsService.getRuleExplanation(
        args.jurisdiction as string,
        args.ruleId as string
      );

    case 'post_journal_entry':
      // This would call the ledger service
      // For now, return a placeholder
      return { entryId: 'mock_entry_id', status: 'pending_approval' };

    case 'get_reconciliation_status':
      // This would call the reconciliation service
      return { accountCode: args.accountCode, matched: 10, unmatched: 2 };

    case 'initiate_filing_submission':
      // This would call the filing service
      return { filingId: args.filingId, status: 'pending_approval' };

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * Build system prompt with context
 */
function buildSystemPrompt(context: Array<{ content: string; reference: string }>): string {
  const contextText = context
    .map((item, index) => `[${index + 1}] ${item.reference}: ${item.content}`)
    .join('\n\n');

  return `You are an expert AI accountant assistant with access to tools for ledger queries, tax calculations, filing generation, and more.

Available Context:
${contextText || 'No specific context available.'}

Instructions:
- Use tools when appropriate to get accurate, real-time data
- Always cite sources using [1], [2], etc. format
- For irreversible actions (like filing submission), explain the implications clearly
- If you need approval for an action, explain why and what will happen
- Be concise but thorough
- Show your work for calculations`;
}

/**
 * Calculate confidence score
 */
function calculateConfidence(
  context: Array<unknown>,
  toolCalls: FunctionCallResult[],
  answer: string
): number {
  let score = 0.5; // Base score

  // Boost for context
  score += Math.min(0.3, context.length * 0.05);

  // Boost for successful tool calls
  const successfulTools = toolCalls.filter(tc => !tc.error).length;
  score += Math.min(0.15, successfulTools * 0.05);

  // Boost for answer length (more detailed answers)
  if (answer.length > 200) {
    score += 0.05;
  }

  return Math.min(0.98, score);
}

/**
 * Check rate limits
 */
async function checkRateLimit(
  tenantId: TenantId,
  toolDef: { rateLimitPerTenant?: number }
): Promise<{ allowed: boolean; reason?: string }> {
  if (!toolDef.rateLimitPerTenant) {
    return { allowed: true };
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM assistant_actions
     WHERE tenant_id = $1
       AND tool_name = $2
       AND created_at > $3`,
    [tenantId, toolDef.name, hourAgo]
  );

  const count = parseInt(result.rows[0]?.count || '0', 10);
  if (count >= toolDef.rateLimitPerTenant) {
    return {
      allowed: false,
      reason: `Rate limit of ${toolDef.rateLimitPerTenant} requests/hour exceeded`,
    };
  }

  return { allowed: true };
}

/**
 * Persist assistant action
 */
async function persistAction(action: {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  conversationId?: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  status: string;
  requiresApproval: boolean;
  isIrreversible: boolean;
  executionMode: string;
}): Promise<void> {
  await db.query(
    `INSERT INTO assistant_actions (
      id, tenant_id, user_id, conversation_id, tool_name, tool_args,
      status, requires_approval, is_irreversible, execution_mode, model_version
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
    [
      action.id,
      action.tenantId,
      action.userId,
      action.conversationId || null,
      action.toolName,
      JSON.stringify(action.toolArgs),
      action.status,
      action.requiresApproval,
      action.isIrreversible,
      action.executionMode,
      MODEL_VERSION,
    ]
  );
}

/**
 * Update assistant action
 */
async function updateAction(
  actionId: string,
  updates: {
    status?: string;
    toolResult?: unknown;
    toolError?: string;
    approvalStatus?: string;
  }
): Promise<void> {
  const updatesList: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (updates.status) {
    updatesList.push(`status = $${paramIndex++}`);
    params.push(updates.status);
  }

  if (updates.toolResult !== undefined) {
    updatesList.push(`tool_result = $${paramIndex++}::jsonb`);
    params.push(JSON.stringify(updates.toolResult));
  }

  if (updates.toolError) {
    updatesList.push(`tool_error = $${paramIndex++}`);
    params.push(updates.toolError);
  }

  if (updates.approvalStatus) {
    updatesList.push(`approval_status = $${paramIndex++}`);
    params.push(updates.approvalStatus);
  }

  if (updatesList.length === 0) {
    return;
  }

  updatesList.push(`updated_at = NOW()`);
  params.push(actionId);

  await db.query(
    `UPDATE assistant_actions SET ${updatesList.join(', ')} WHERE id = $${paramIndex}`,
    params
  );
}
