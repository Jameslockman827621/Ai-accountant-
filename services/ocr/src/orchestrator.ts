import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('ocr-orchestrator');

export type OCRProvider = 'google_document_ai' | 'aws_textract' | 'paddleocr' | 'tesseract';

export interface OCRResult {
  rawText: string;
  tokens: Array<{
    text: string;
    bbox: { x: number; y: number; width: number; height: number };
    confidence: number;
  }>;
  boundingBoxes: Array<{ x: number; y: number; width: number; height: number }>;
  layoutStructure: {
    pages: Array<{
      pageNumber: number;
      blocks: Array<{
        type: string;
        text: string;
        bbox: { x: number; y: number; width: number; height: number };
      }>;
    }>;
  };
  language: string;
  confidenceScores: Record<string, number>;
  processingTimeMs: number;
}

export interface OCRJobConfig {
  documentId: string;
  storageKey: string;
  tenantId: TenantId;
  preferredLanguages?: string[];
  documentType?: string;
  fileType?: string;
}

/**
 * OCR Orchestrator (Chunk 2)
 * Selects best OCR provider based on document type and language
 */
export class OCROrchestrator {
  /**
   * Process document with appropriate OCR provider
   */
  async processDocument(config: OCRJobConfig, fileBuffer: Buffer): Promise<OCRResult> {
    const provider = await this.selectProvider(config);
    logger.info('OCR provider selected', {
      documentId: config.documentId,
      provider,
      languages: config.preferredLanguages,
    });

    const startTime = Date.now();
    let result: OCRResult;

    try {
      switch (provider) {
        case 'google_document_ai':
          result = await this.processWithDocumentAI(config, fileBuffer);
          break;
        case 'aws_textract':
          result = await this.processWithTextract(config, fileBuffer);
          break;
        case 'paddleocr':
          result = await this.processWithPaddleOCR(config, fileBuffer);
          break;
        case 'tesseract':
        default:
          result = await this.processWithTesseract(config, fileBuffer);
          break;
      }

      result.processingTimeMs = Date.now() - startTime;

      // Store extraction results
      await this.storeExtraction(config.documentId, provider, result);

      // Track usage metrics
      await this.trackUsage(config.tenantId, config.documentId, provider, result);

      return result;
    } catch (error) {
      logger.error('OCR processing failed', {
        documentId: config.documentId,
        provider,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * Select best OCR provider based on document characteristics
   */
  private async selectProvider(config: OCRJobConfig): Promise<OCRProvider> {
    // Get tenant preferences
    const tenantPrefs = await this.getTenantPreferences(config.tenantId);
    const languages = config.preferredLanguages || tenantPrefs.preferredLanguages || ['en'];

    // Check if document is PDF
    const isPDF = config.fileType === 'application/pdf' || config.storageKey.endsWith('.pdf');

    // Check if document contains handwriting (would need ML model in production)
    const hasHandwriting = false; // Placeholder

    // Selection logic
    if (hasHandwriting) {
      return 'paddleocr'; // Best for handwriting
    }

    if (isPDF && languages.includes('en')) {
      // Prefer cloud providers for PDFs
      if (process.env.GOOGLE_DOCUMENT_AI_ENABLED === 'true') {
        return 'google_document_ai';
      }
      if (process.env.AWS_TEXTRACT_ENABLED === 'true') {
        return 'aws_textract';
      }
    }

    // Fallback to Tesseract
    return 'tesseract';
  }

  /**
   * Process with Google Document AI
   */
  private async processWithDocumentAI(
    config: OCRJobConfig,
    fileBuffer: Buffer
  ): Promise<OCRResult> {
    // In production, would call Google Document AI API
    // For now, return mock result
    logger.info('Processing with Google Document AI', { documentId: config.documentId });

    // Mock implementation
    return {
      rawText: 'Mock extracted text from Google Document AI',
      tokens: [],
      boundingBoxes: [],
      layoutStructure: {
        pages: [{
          pageNumber: 1,
          blocks: [],
        }],
      },
      language: config.preferredLanguages?.[0] || 'en',
      confidenceScores: { overall: 0.95 },
      processingTimeMs: 0,
    };
  }

  /**
   * Process with AWS Textract
   */
  private async processWithTextract(
    config: OCRJobConfig,
    fileBuffer: Buffer
  ): Promise<OCRResult> {
    logger.info('Processing with AWS Textract', { documentId: config.documentId });

    // Mock implementation
    return {
      rawText: 'Mock extracted text from AWS Textract',
      tokens: [],
      boundingBoxes: [],
      layoutStructure: {
        pages: [{
          pageNumber: 1,
          blocks: [],
        }],
      },
      language: config.preferredLanguages?.[0] || 'en',
      confidenceScores: { overall: 0.93 },
      processingTimeMs: 0,
    };
  }

  /**
   * Process with PaddleOCR
   */
  private async processWithPaddleOCR(
    config: OCRJobConfig,
    fileBuffer: Buffer
  ): Promise<OCRResult> {
    logger.info('Processing with PaddleOCR', { documentId: config.documentId });

    // Mock implementation
    return {
      rawText: 'Mock extracted text from PaddleOCR',
      tokens: [],
      boundingBoxes: [],
      layoutStructure: {
        pages: [{
          pageNumber: 1,
          blocks: [],
        }],
      },
      language: config.preferredLanguages?.[0] || 'en',
      confidenceScores: { overall: 0.90 },
      processingTimeMs: 0,
    };
  }

  /**
   * Process with Tesseract (fallback)
   */
  private async processWithTesseract(
    config: OCRJobConfig,
    fileBuffer: Buffer
  ): Promise<OCRResult> {
    logger.info('Processing with Tesseract', { documentId: config.documentId });

    // Mock implementation - in production would use tesseract.js
    return {
      rawText: 'Mock extracted text from Tesseract',
      tokens: [],
      boundingBoxes: [],
      layoutStructure: {
        pages: [{
          pageNumber: 1,
          blocks: [],
        }],
      },
      language: config.preferredLanguages?.[0] || 'en',
      confidenceScores: { overall: 0.85 },
      processingTimeMs: 0,
    };
  }

  /**
   * Store extraction results in database
   */
  private async storeExtraction(
    documentId: string,
    provider: OCRProvider,
    result: OCRResult
  ): Promise<void> {
    await db.query(
      `INSERT INTO document_extractions (
        id, document_id, extraction_provider, extraction_model,
        language, tokens, bounding_boxes, layout_structure,
        raw_text, processing_time_ms, page_count, confidence_scores,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb,
        $8, $9, $10, $11::jsonb, NOW(), NOW()
      ) ON CONFLICT (document_id) DO UPDATE
      SET extraction_provider = $2,
          extraction_model = $3,
          language = $4,
          tokens = $5::jsonb,
          bounding_boxes = $6::jsonb,
          layout_structure = $7::jsonb,
          raw_text = $8,
          processing_time_ms = $9,
          page_count = $10,
          confidence_scores = $11::jsonb,
          updated_at = NOW()`,
      [
        documentId,
        provider,
        `${provider}_v1`, // Model version
        result.language,
        JSON.stringify(result.tokens),
        JSON.stringify(result.boundingBoxes),
        JSON.stringify(result.layoutStructure),
        result.rawText,
        result.processingTimeMs,
        result.layoutStructure.pages.length,
        JSON.stringify(result.confidenceScores),
      ]
    );
  }

  /**
   * Track OCR usage metrics
   */
  private async trackUsage(
    tenantId: TenantId,
    documentId: string,
    provider: OCRProvider,
    result: OCRResult
  ): Promise<void> {
    // Calculate cost (mock - in production would use actual pricing)
    const costPerPage = {
      google_document_ai: 0.0015,
      aws_textract: 0.0015,
      paddleocr: 0.0, // Open source
      tesseract: 0.0, // Open source
    };

    const pageCount = result.layoutStructure.pages.length;
    const costUsd = (costPerPage[provider] || 0) * pageCount;

    await db.query(
      `INSERT INTO ocr_usage_metrics (
        id, tenant_id, document_id, provider, model,
        api_calls, pages_processed, cost_usd, processing_time_ms,
        success, created_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, 1, $5, $6, $7, true, NOW()
      )`,
      [
        tenantId,
        documentId,
        provider,
        `${provider}_v1`,
        pageCount,
        costUsd,
        result.processingTimeMs,
      ]
    );
  }

  /**
   * Get tenant preferences
   */
  private async getTenantPreferences(tenantId: TenantId): Promise<{
    preferredLanguages: string[];
  }> {
    const result = await db.query<{
      preferred_languages: string[] | null;
    }>(
      'SELECT preferred_languages FROM tenants WHERE id = $1',
      [tenantId]
    );

    return {
      preferredLanguages: result.rows[0]?.preferred_languages || ['en'],
    };
  }
}

export const ocrOrchestrator = new OCROrchestrator();
