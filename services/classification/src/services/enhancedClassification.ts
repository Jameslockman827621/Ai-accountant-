import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { DocumentId, DocumentType, ExtractedData } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { processClassificationJob } from '../processor';
import { calibrationService } from './calibration';

const logger = createLogger('enhanced-classification');

export interface ReasoningTrace {
  features: FeatureSet; // Feature values
  weights: Record<string, number>; // Feature importance/weights
  decisionPath: Array<{
    step: number;
    description: string;
    confidence: number;
    reasoning: string;
  }>;
  confidenceBreakdown: Record<string, number>; // Per-feature confidence
  alternativePredictions: Array<{
    prediction: string;
    confidence: number;
    reasoning: string;
  }>;
}

export interface EnhancedClassificationResult {
  documentType: DocumentType;
  extractedData: ExtractedData;
  confidenceScore: number;
  fieldConfidences: Record<string, number>;
  reasoningTrace: ReasoningTrace;
  modelVersion: string;
}

interface ClassificationSummary {
  documentType: DocumentType;
  extractedData: ExtractedData;
  confidenceScore: number;
}

interface FeatureSet {
  textLength: number;
  hasInvoiceKeywords: number;
  hasReceiptKeywords: number;
  hasDate: number;
  hasAmount: number;
  hasInvoiceNumber: number;
}

interface ModelInfo {
  modelName: string;
  modelVersion: string;
}

class ModelRegistryServiceStub {
  async getModel(_modelName: string, _modelVersion: string): Promise<ModelInfo> {
    return { modelName: 'classification-model', modelVersion: '1.0.0' };
  }
}

const modelRegistryService = new ModelRegistryServiceStub();

export class EnhancedClassificationService {
  /**
   * Classify document with reasoning traces
   */
  async classifyWithReasoning(
    documentId: DocumentId,
    extractedText: string
  ): Promise<EnhancedClassificationResult> {
    const startTime = Date.now();

    // Get current model
    const model = await modelRegistryService.getModel('classification-model', 'production');
    const modelId = model ? await this.getModelId(model.modelName, model.modelVersion) : null;

    // Perform classification
    const classificationResult = await processClassificationJob(extractedText);

    // Build reasoning trace
    const reasoningTrace = await this.buildReasoningTrace(
      extractedText,
      classificationResult,
      modelId
    );

    // Calibrate field confidences
    const fieldConfidences: Record<string, number> = {};
    if (modelId) {
      for (const [field, value] of Object.entries(classificationResult.extractedData)) {
        if (typeof value === 'number' || typeof value === 'string') {
          // Get raw confidence (would come from model in production)
          const rawConfidence = classificationResult.confidenceScore;
          const calibrated = await calibrationService.calibrateField(modelId, field, rawConfidence);
          fieldConfidences[field] = calibrated.calibratedConfidence;
        }
      }
    }

    // Store reasoning trace
    await this.storeReasoningTrace(documentId, modelId, 'classification', reasoningTrace);

    const processingTime = Date.now() - startTime;

    logger.info('Enhanced classification completed', {
      documentId,
      documentType: classificationResult.documentType,
      confidence: classificationResult.confidenceScore,
      processingTime,
    });

    return {
      documentType: classificationResult.documentType,
      extractedData: classificationResult.extractedData,
      confidenceScore: classificationResult.confidenceScore,
      fieldConfidences,
      reasoningTrace,
      modelVersion: model?.modelVersion || '1.0.0',
    };
  }

  /**
   * Build reasoning trace from classification
   */
  private async buildReasoningTrace(
    text: string,
    result: ClassificationSummary,
    _modelId: string | null
  ): Promise<ReasoningTrace> {
    // Extract features
    const features: FeatureSet = {
      textLength: text.length,
      hasInvoiceKeywords: this.hasKeywords(text, ['invoice', 'bill', 'due date']) ? 1 : 0,
      hasReceiptKeywords: this.hasKeywords(text, ['receipt', 'thank you', 'total paid']) ? 1 : 0,
      hasDate: this.hasDate(text) ? 1 : 0,
      hasAmount: this.hasAmount(text) ? 1 : 0,
      hasInvoiceNumber: this.hasInvoiceNumber(text) ? 1 : 0,
    };

    // Compute feature weights (would come from model in production)
    const weights: Record<string, number> = {
      textLength: 0.1,
      hasInvoiceKeywords: 0.3,
      hasReceiptKeywords: 0.3,
      hasDate: 0.15,
      hasAmount: 0.1,
      hasInvoiceNumber: 0.05,
    };

    // Build decision path
    const decisionPath: ReasoningTrace['decisionPath'] = [
      {
        step: 1,
        description: 'Extract text features',
        confidence: 0.8,
        reasoning: `Text length: ${text.length} characters`,
      },
      {
        step: 2,
        description: 'Check for document type keywords',
        confidence: features.hasInvoiceKeywords > 0 ? 0.9 : 0.5,
        reasoning:
          features.hasInvoiceKeywords > 0
            ? 'Found invoice-related keywords'
            : 'No invoice keywords found',
      },
      {
        step: 3,
        description: 'Extract structured fields',
        confidence: result.confidenceScore,
        reasoning: `Extracted ${Object.keys(result.extractedData).length} fields`,
      },
      {
        step: 4,
        description: 'Final classification',
        confidence: result.confidenceScore,
        reasoning: `Classified as ${result.documentType} with ${(result.confidenceScore * 100).toFixed(1)}% confidence`,
      },
    ];

    // Confidence breakdown
    const confidenceBreakdown: Record<string, number> = {};
    for (const [feature, value] of Object.entries(features)) {
      confidenceBreakdown[feature] = value * (weights[feature] || 0);
    }

    // Alternative predictions
    const alternativePredictions: ReasoningTrace['alternativePredictions'] = [
      {
        prediction: result.documentType,
        confidence: result.confidenceScore,
        reasoning: 'Primary prediction based on extracted features',
      },
      {
        prediction: DocumentType.OTHER,
        confidence: 1 - result.confidenceScore,
        reasoning: 'Fallback prediction',
      },
    ];

    return {
      features,
      weights,
      decisionPath,
      confidenceBreakdown,
      alternativePredictions,
    };
  }

  /**
   * Store reasoning trace in database
   */
  private async storeReasoningTrace(
    documentId: DocumentId,
    modelId: string | null,
    traceType: 'classification' | 'extraction' | 'validation' | 'posting',
    trace: ReasoningTrace
  ): Promise<string> {
    const traceId = randomUUID();

    await db.query(
      `INSERT INTO reasoning_traces (
        id, document_id, model_id, trace_type, features, weights,
        decision_path, confidence_breakdown, alternative_predictions, created_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, NOW())`,
      [
        traceId,
        documentId,
        modelId,
        traceType,
        JSON.stringify(trace.features),
        JSON.stringify(trace.weights),
        JSON.stringify(trace.decisionPath),
        JSON.stringify(trace.confidenceBreakdown),
        JSON.stringify(trace.alternativePredictions),
      ]
    );

    return traceId;
  }

  /**
   * Get model ID from name and version
   */
  private async getModelId(modelName: string, modelVersion: string): Promise<string | null> {
    const result = await db.query<{ id: string }>(
      `SELECT id FROM model_registry
       WHERE model_name = $1 AND model_version = $2`,
      [modelName, modelVersion]
    );

    const row = result.rows[0];
    return row ? row.id : null;
  }

  /**
   * Helper: Check for keywords
   */
  private hasKeywords(text: string, keywords: string[]): boolean {
    const lowerText = text.toLowerCase();
    return keywords.some((keyword) => lowerText.includes(keyword.toLowerCase()));
  }

  /**
   * Helper: Check for date
   */
  private hasDate(text: string): boolean {
    return /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(text);
  }

  /**
   * Helper: Check for amount
   */
  private hasAmount(text: string): boolean {
    return /(?:£|€|\$|USD|GBP)?\s*[\d,]+\.?\d*/.test(text);
  }

  /**
   * Helper: Check for invoice number
   */
  private hasInvoiceNumber(text: string): boolean {
    return /(?:invoice|inv)[\s#:]*[A-Z0-9-]+/i.test(text);
  }
}

export const enhancedClassificationService = new EnhancedClassificationService();
