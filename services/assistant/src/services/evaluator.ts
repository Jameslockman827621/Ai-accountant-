import { TenantId } from '@ai-accountant/shared-types';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import evalSet from '../data/evalSet.json';
import { queryAssistant } from './rag';

const logger = createLogger('assistant-service');

interface EvalSample {
  id: string;
  question: string;
  requiredKeywords?: string[];
  minConfidence?: number;
}

export interface EvaluationResult {
  sampleId: string;
  question: string;
  answer: string;
  confidence: number;
  keywordCoverage: number;
  citations: number;
  passed: boolean;
  notes?: string;
}

export interface EvaluationReport {
  totalSamples: number;
  passed: number;
  averageConfidence: number;
  averageCoverage: number;
  results: EvaluationResult[];
}

export async function runAssistantEvaluation(
  tenantId: TenantId,
  limit?: number
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
  let passedCount = 0;

  for (const sample of samples) {
    try {
      const response = await queryAssistant(tenantId, sample.question);
      const answerLower = response.answer.toLowerCase();
      const keywords = sample.requiredKeywords || [];
      const matches = keywords.filter(keyword => answerLower.includes(keyword.toLowerCase())).length;
      const coverage = keywords.length > 0 ? matches / keywords.length : 1;
      const confidence = response.confidenceScore ?? 0;
      const minConfidence = sample.minConfidence ?? 0.6;
      const passed = coverage >= 0.7 && confidence >= minConfidence && response.citations.length > 0;

      confidenceSum += confidence;
      coverageSum += coverage;
      if (passed) {
        passedCount += 1;
      }

      results.push({
        sampleId: sample.id,
        question: sample.question,
        answer: response.answer,
        confidence: Number(confidence.toFixed(2)),
        keywordCoverage: Number(coverage.toFixed(2)),
        citations: response.citations.length,
        passed,
        notes: passed
          ? undefined
          : `Expected coverage ≥ 0.7 and confidence ≥ ${minConfidence}.`,
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
        passed: false,
        notes: 'Assistant query failed',
      });
    }
  }

  return {
    totalSamples: samples.length,
    passed: passedCount,
    averageConfidence: Number((confidenceSum / samples.length).toFixed(2)),
    averageCoverage: Number((coverageSum / samples.length).toFixed(2)),
    results,
  };
}
