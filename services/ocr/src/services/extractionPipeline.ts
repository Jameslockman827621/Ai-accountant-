import { createLogger } from '@ai-accountant/shared-utils';
import { performEnhancedOCR } from './enhancedOCR';
import { modelRegistryService } from '@ai-accountant/modelops/src/services/modelRegistry';

const logger = createLogger('extraction-pipeline');

export interface ExtractionPipelineResult {
  rawText: string;
  structuredFields: Record<string, { value: unknown; confidence: number }>;
  layout: {
    pages: Array<{
      pageNumber: number;
      regions: Array<{
        type: 'header' | 'body' | 'footer' | 'table' | 'list';
        bbox: { x0: number; y0: number; x1: number; y1: number };
        content: string;
      }>;
    }>;
  };
  semantic: {
    entities: Array<{
      type: string;
      value: string;
      confidence: number;
      bbox?: { x0: number; y0: number; x1: number; y1: number };
    }>;
    relationships: Array<{
      source: string;
      target: string;
      type: string;
      confidence: number;
    }>;
  };
  modelVersion: string;
  processingTime: number;
}

/**
 * Complete extraction pipeline: pre-processing → OCR → layout → semantic
 */
export class ExtractionPipeline {
  private modelVersion: string = '1.0.0';

  /**
   * Initialize pipeline with model version
   */
  async initialize(): Promise<void> {
    const model = await modelRegistryService.getModel('extraction-pipeline', 'production');
    if (model) {
      this.modelVersion = model.modelVersion;
    }
  }

  /**
   * Run complete extraction pipeline
   */
  async extract(
    imageBuffer: Buffer,
    documentType?: string
  ): Promise<ExtractionPipelineResult> {
    const startTime = Date.now();

    try {
      // Step 1: Pre-processing
      const preprocessed = await this.preprocess(imageBuffer);

      // Step 2: OCR
      const ocrResult = await this.performOCR(preprocessed);

      // Step 3: Layout Understanding
      const layout = await this.understandLayout(ocrResult);

      // Step 4: Semantic Extraction
      const semantic = await this.extractSemantic(ocrResult, layout, documentType);

      // Step 5: Structured Field Extraction
      const structuredFields = await this.extractStructuredFields(semantic, documentType);

      const processingTime = Date.now() - startTime;

      logger.info('Extraction pipeline completed', {
        modelVersion: this.modelVersion,
        processingTime,
        fieldCount: Object.keys(structuredFields).length,
      });

      return {
        rawText: ocrResult.text,
        structuredFields,
        layout,
        semantic,
        modelVersion: this.modelVersion,
        processingTime,
      };
    } catch (error) {
      logger.error('Extraction pipeline failed', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * Pre-processing stage
   */
  private async preprocess(imageBuffer: Buffer): Promise<Buffer> {
    // Enhanced pre-processing (already handled in enhancedOCR, but can add more)
    // In production, would include: denoising, deskewing, contrast enhancement
    logger.debug('Pre-processing image');
    return imageBuffer;
  }

  /**
   * OCR stage
   */
  private async performOCR(imageBuffer: Buffer): Promise<{
    text: string;
    confidence: number;
    words: Array<{ text: string; confidence: number; bbox: any }>;
  }> {
    logger.debug('Performing OCR');
    return await performEnhancedOCR(imageBuffer, {
      preprocess: true,
      language: 'eng',
    });
  }

  /**
   * Layout understanding stage
   */
  private async understandLayout(ocrResult: {
    text: string;
    words: Array<{ text: string; bbox: any }>;
  }): Promise<ExtractionPipelineResult['layout']> {
    logger.debug('Understanding layout');

    // In production, would use layout analysis models (e.g., LayoutLM, TableNet)
    // For now, using heuristic-based layout detection
    const pages: ExtractionPipelineResult['layout']['pages'] = [
      {
        pageNumber: 1,
        regions: this.detectRegions(ocrResult.words),
      },
    ];

    return { pages };
  }

  /**
   * Detect regions in document (heuristic-based)
   */
  private detectRegions(words: Array<{ text: string; bbox: any }>): Array<{
    type: 'header' | 'body' | 'footer' | 'table' | 'list';
    bbox: { x0: number; y0: number; x1: number; y1: number };
    content: string;
  }> {
    if (words.length === 0) {
      return [];
    }

    // Simple region detection based on Y position
    const regions: Array<{
      type: 'header' | 'body' | 'footer' | 'table' | 'list';
      bbox: { x0: number; y0: number; x1: number; y1: number };
      content: string;
    }> = [];

    // Find bounding box
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const word of words) {
      minX = Math.min(minX, word.bbox.x0);
      minY = Math.min(minY, word.bbox.y0);
      maxX = Math.max(maxX, word.bbox.x1);
      maxY = Math.max(maxY, word.bbox.y1);
    }

    const height = maxY - minY;
    const headerThreshold = minY + height * 0.15;
    const footerThreshold = minY + height * 0.85;

    // Classify words into regions
    const headerWords: typeof words = [];
    const bodyWords: typeof words = [];
    const footerWords: typeof words = [];

    for (const word of words) {
      const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
      if (centerY < headerThreshold) {
        headerWords.push(word);
      } else if (centerY > footerThreshold) {
        footerWords.push(word);
      } else {
        bodyWords.push(word);
      }
    }

    if (headerWords.length > 0) {
      regions.push({
        type: 'header',
        bbox: this.getBoundingBox(headerWords),
        content: headerWords.map((w) => w.text).join(' '),
      });
    }

    if (bodyWords.length > 0) {
      // Check if body looks like a table
      const isTable = this.detectTableStructure(bodyWords);
      regions.push({
        type: isTable ? 'table' : 'body',
        bbox: this.getBoundingBox(bodyWords),
        content: bodyWords.map((w) => w.text).join(' '),
      });
    }

    if (footerWords.length > 0) {
      regions.push({
        type: 'footer',
        bbox: this.getBoundingBox(footerWords),
        content: footerWords.map((w) => w.text).join(' '),
      });
    }

    return regions;
  }

  /**
   * Detect if words form a table structure
   */
  private detectTableStructure(words: Array<{ bbox: any }>): boolean {
    // Simple heuristic: check for aligned columns
    if (words.length < 6) return false;

    const xPositions = words.map((w) => w.bbox.x0).sort((a, b) => a - b);
    const clusters = this.clusterPositions(xPositions, 50); // 50px tolerance

    return clusters.length >= 3; // At least 3 columns suggests a table
  }

  /**
   * Cluster positions into groups
   */
  private clusterPositions(positions: number[], tolerance: number): number[][] {
    const clusters: number[][] = [];
    let currentCluster: number[] = [positions[0]];

    for (let i = 1; i < positions.length; i++) {
      if (positions[i] - positions[i - 1] <= tolerance) {
        currentCluster.push(positions[i]);
      } else {
        clusters.push(currentCluster);
        currentCluster = [positions[i]];
      }
    }
    clusters.push(currentCluster);

    return clusters;
  }

  /**
   * Get bounding box for words
   */
  private getBoundingBox(words: Array<{ bbox: any }>): {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;

    for (const word of words) {
      x0 = Math.min(x0, word.bbox.x0);
      y0 = Math.min(y0, word.bbox.y0);
      x1 = Math.max(x1, word.bbox.x1);
      y1 = Math.max(y1, word.bbox.y1);
    }

    return { x0, y0, x1, y1 };
  }

  /**
   * Semantic extraction stage
   */
  private async extractSemantic(
    ocrResult: { text: string; words: Array<{ text: string; bbox: any }> },
    layout: ExtractionPipelineResult['layout'],
    documentType?: string
  ): Promise<ExtractionPipelineResult['semantic']> {
    logger.debug('Extracting semantic information');

    // In production, would use NER models, relationship extraction
    const entities: ExtractionPipelineResult['semantic']['entities'] = [];
    const relationships: ExtractionPipelineResult['semantic']['relationships'] = [];

    // Extract common entities using patterns
    const text = ocrResult.text;

    // Extract dates
    const datePattern = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/g;
    let match;
    while ((match = datePattern.exec(text)) !== null) {
      entities.push({
        type: 'date',
        value: match[1],
        confidence: 0.8,
      });
    }

    // Extract amounts
    const amountPattern = /(?:£|€|\$|USD|GBP)?\s*([\d,]+\.?\d*)/g;
    while ((match = amountPattern.exec(text)) !== null) {
      entities.push({
        type: 'amount',
        value: match[1],
        confidence: 0.75,
      });
    }

    // Extract invoice numbers
    const invoicePattern = /(?:invoice|inv)[\s#:]*([A-Z0-9-]+)/gi;
    while ((match = invoicePattern.exec(text)) !== null) {
      entities.push({
        type: 'invoice_number',
        value: match[1],
        confidence: 0.85,
      });
    }

    return { entities, relationships };
  }

  /**
   * Extract structured fields from semantic data
   */
  private async extractStructuredFields(
    semantic: ExtractionPipelineResult['semantic'],
    documentType?: string
  ): Promise<Record<string, { value: unknown; confidence: number }>> {
    const fields: Record<string, { value: unknown; confidence: number }> = {};

    // Map semantic entities to structured fields
    for (const entity of semantic.entities) {
      switch (entity.type) {
        case 'date':
          if (!fields.date || entity.confidence > fields.date.confidence) {
            fields.date = { value: entity.value, confidence: entity.confidence };
          }
          break;
        case 'amount':
          const amount = parseFloat(entity.value.replace(/,/g, ''));
          if (!fields.total || entity.confidence > fields.total.confidence) {
            fields.total = { value: amount, confidence: entity.confidence };
          }
          break;
        case 'invoice_number':
          fields.invoiceNumber = { value: entity.value, confidence: entity.confidence };
          break;
      }
    }

    return fields;
  }
}

export const extractionPipeline = new ExtractionPipeline();
