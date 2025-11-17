import { TenantId, UserId } from '@ai-accountant/shared-types';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import evalSet from '../data/evalSet.json';
import { queryAssistant } from './rag';
import { queryAssistantWithTools } from './functionCalling';
import { db } from '@ai-accountant/database';

const logger = createLogger('assistant-evaluator');

interface EvalSample {
  id: string;
  question: string;
  requiredKeywords?: string[];
  minConfidence?: number;
  domain?: string;
  expectedToolCalls?: string[];
}

export interface EvaluationResult {
  sampleId: string;
  question: string;
  answer: string;
  confidence: number;
  keywordCoverage: number;
  citations: number;
  toolCallsCount: number;
  expectedToolCalls?: string[];
  actualToolCalls: string[];
  passed: boolean;
  notes?: string;
  domain?: string;
  metrics: {
    factuality: number;
    groundedness: number;
    bleu?: number;
  };
}

export interface EvaluationReport {
  totalSamples: number;
  passed: number;
  averageConfidence: number;
  averageCoverage: number;
  averageFactuality: number;
  averageGroundedness: number;
  byDomain: Record<string, { total: number; passed: number }>;
  results: EvaluationResult[];
  timestamp: Date;
}

export async function runAssistantEvaluation(
  tenantId: TenantId,
  limit?: number,
  userId?: UserId
): Promise<EvaluationReport> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ValidationError('Assistant evaluation requires OPENAI_API_KEY to be configured.');
  }

  const samples = (evalSet as EvalSample[]).slice(0, limit ?? evalSet.length);
  if (samples.length === 0) {
    throw new ValidationError('Evaluation set is empty.');
  }

  const results: EvaluationResult[] = [];
  let confidenceSum = 0;
  let coverageSum = 0;
  let factualitySum = 0;
  let groundednessSum = 0;
  let passedCount = 0;
  const byDomain: Record<string, { total: number; passed: number }> = {};

  for (const sample of samples) {
    try {
      // Use enhanced function calling service
      const response = userId
        ? await queryAssistantWithTools(tenantId, userId, sample.question, undefined, 'sandbox')
        : await queryAssistant(tenantId, sample.question);

      const answerLower = response.answer.toLowerCase();
      const keywords = sample.requiredKeywords || [];
      const matches = keywords.filter(keyword => answerLower.includes(keyword.toLowerCase())).length;
      const coverage = keywords.length > 0 ? matches / keywords.length : 1;
      const confidence = response.confidenceScore ?? 0;
      const minConfidence = sample.minConfidence ?? 0.6;

      // Check tool calls
      const actualToolCalls = 'toolCalls' in response
        ? response.toolCalls.map(tc => tc.toolName)
        : [];
      const expectedToolCalls = sample.expectedToolCalls || [];
      const toolCallsMatch = expectedToolCalls.length === 0
        ? true
        : expectedToolCalls.some(tool => actualToolCalls.includes(tool));

      // Calculate metrics
      const factuality = calculateFactuality(response.answer, sample);
      const groundedness = calculateGroundedness(response.citations.length, response.answer);

      const passed =
        coverage >= 0.7 &&
        confidence >= minConfidence &&
        response.citations.length > 0 &&
        toolCallsMatch &&
        factuality >= 0.8;

      confidenceSum += confidence;
      coverageSum += coverage;
      factualitySum += factuality;
      groundednessSum += groundedness;
      if (passed) {
        passedCount += 1;
      }

      // Track by domain
      const domain = sample.domain || 'general';
      if (!byDomain[domain]) {
        byDomain[domain] = { total: 0, passed: 0 };
      }
      byDomain[domain].total += 1;
      if (passed) {
        byDomain[domain].passed += 1;
      }

      results.push({
        sampleId: sample.id,
        question: sample.question,
        answer: response.answer,
        confidence: Number(confidence.toFixed(2)),
        keywordCoverage: Number(coverage.toFixed(2)),
        citations: response.citations.length,
        toolCallsCount: actualToolCalls.length,
        expectedToolCalls: expectedToolCalls.length > 0 ? expectedToolCalls : undefined,
        actualToolCalls,
        passed,
        notes: passed
          ? undefined
          : `Expected coverage ≥ 0.7, confidence ≥ ${minConfidence}, citations > 0, and appropriate tool calls.`,
        domain: sample.domain,
        metrics: {
          factuality: Number(factuality.toFixed(2)),
          groundedness: Number(groundedness.toFixed(2)),
        },
      });
    } catch (error) {
      logger.error('Assistant evaluation sample failed', {
        sample: sample.id,
        error: error instanceof Error ? error.message : String(error),
      });
      results.push({
        sampleId: sample.id,
        question: sample.question,
        answer: 'Evaluation failed',
        confidence: 0,
        keywordCoverage: 0,
        citations: 0,
        toolCallsCount: 0,
        actualToolCalls: [],
        passed: false,
        notes: 'Assistant query failed',
        domain: sample.domain,
        metrics: {
          factuality: 0,
          groundedness: 0,
        },
      });
    }
  }

  // Store evaluation results
  if (userId) {
    try {
      await db.query(
        `INSERT INTO assistant_evaluation_runs (
          tenant_id, user_id, total_samples, passed, average_confidence,
          average_coverage, average_factuality, average_groundedness, results, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())`,
        [
          tenantId,
          userId,
          samples.length,
          passedCount,
          Number((confidenceSum / samples.length).toFixed(2)),
          Number((coverageSum / samples.length).toFixed(2)),
          Number((factualitySum / samples.length).toFixed(2)),
          Number((groundednessSum / samples.length).toFixed(2)),
          JSON.stringify(results),
        ]
      );
    } catch (error) {
      logger.error('Failed to store evaluation results', error instanceof Error ? error : new Error(String(error)));
    }
  }

  return {
    totalSamples: samples.length,
    passed: passedCount,
    averageConfidence: Number((confidenceSum / samples.length).toFixed(2)),
    averageCoverage: Number((coverageSum / samples.length).toFixed(2)),
    averageFactuality: Number((factualitySum / samples.length).toFixed(2)),
    averageGroundedness: Number((groundednessSum / samples.length).toFixed(2)),
    byDomain,
    results,
    timestamp: new Date(),
  };
}

/**
 * Calculate factuality score (simplified - in production would use more sophisticated methods)
 */
function calculateFactuality(answer: string, sample: EvalSample): number {
  // Check if answer contains factual claims that can be verified
  // In production, would use fact-checking models or cross-reference with knowledge base
  let score = 0.5;

  // Boost if answer contains numbers (likely factual)
  if (/\d+/.test(answer)) {
    score += 0.2;
  }

  // Boost if answer contains citations
  if (answer.includes('[') && answer.includes(']')) {
    score += 0.2;
  }

  // Boost if answer avoids speculative language
  const speculativeWords = ['maybe', 'perhaps', 'might', 'could', 'possibly'];
  const hasSpeculative = speculativeWords.some(word => answer.toLowerCase().includes(word));
  if (!hasSpeculative) {
    score += 0.1;
  }

  return Math.min(1.0, score);
}

/**
 * Calculate groundedness score
 */
function calculateGroundedness(citationsCount: number, answer: string): number {
  let score = 0.3; // Base score

  // Boost for citations
  score += Math.min(0.5, citationsCount * 0.1);

  // Boost if answer references specific sources
  if (answer.includes('according to') || answer.includes('based on')) {
    score += 0.2;
  }

  return Math.min(1.0, score);
}
