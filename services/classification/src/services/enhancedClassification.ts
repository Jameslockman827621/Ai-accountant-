import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { DocumentType } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('enhanced-classification');

export interface ClassificationResult {
  documentType: DocumentType;
  confidenceScore: number;
  modelVersion: string;
  modelType: 'transformer' | 'deterministic' | 'hybrid';
  extractedFields: Record<string, FieldExtraction>;
  fieldConfidenceScores: Record<string, number>;
  vendorName?: string;
  vendorConfidence?: number;
  customerName?: string;
  customerConfidence?: number;
  taxAmount?: number;
  taxRate?: number;
  taxType?: string;
  taxCountry?: string;
  lineItems?: LineItem[];
  totalAmount?: number;
  currency?: string;
  glCodeSuggestion?: string;
  glCodeConfidence?: number;
  complianceFlags?: string[];
  tags?: string[];
  recurringVendor?: boolean;
  qualityScore?: number;
  completenessScore?: number;
  requiresReview: boolean;
  reviewReason?: string;
}

export interface FieldExtraction {
  value: unknown;
  confidence: number;
  source: 'ai' | 'regex' | 'template' | 'manual';
}

export interface LineItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
  total: number;
  tax?: number;
  category?: string;
}

export class EnhancedClassificationService {
  /**
   * Classify document with enhanced features
   */
  async classifyDocument(
    tenantId: string,
    documentId: string,
    extractedText: string,
    metadata?: Record<string, unknown>
  ): Promise<ClassificationResult> {
    const startTime = Date.now();

    try {
      // Use transformer model (in production would call actual ML service)
      const transformerResult = await this.classifyWithTransformer(extractedText, metadata);

      // Fallback to deterministic if confidence is low
      if (transformerResult.confidenceScore < 0.7) {
        logger.warn('Low confidence from transformer, using deterministic fallback', {
          documentId,
          confidence: transformerResult.confidenceScore,
        });
        const deterministicResult = await this.classifyWithDeterministic(extractedText);
        
        // Combine results
        return this.combineResults(transformerResult, deterministicResult);
      }

      // Enrich with vendor data
      if (transformerResult.vendorName) {
        const vendorEnrichment = await this.enrichVendor(tenantId, transformerResult.vendorName);
        if (vendorEnrichment) {
          transformerResult.vendorName = vendorEnrichment.name;
          transformerResult.vendorConfidence = Math.max(
            transformerResult.vendorConfidence || 0.5,
            vendorEnrichment.confidence
          );
        }
      }

      // Auto-tagging
      transformerResult.tags = await this.generateTags(tenantId, transformerResult);
      transformerResult.recurringVendor = await this.checkRecurringVendor(tenantId, transformerResult.vendorName);

      // GL code suggestion
      const glSuggestion = await this.suggestGLCode(tenantId, transformerResult);
      transformerResult.glCodeSuggestion = glSuggestion.code;
      transformerResult.glCodeConfidence = glSuggestion.confidence;

      // Compliance flags
      transformerResult.complianceFlags = await this.checkCompliance(tenantId, transformerResult);

      // Quality and completeness scores
      transformerResult.qualityScore = this.calculateQualityScore(transformerResult);
      transformerResult.completenessScore = this.calculateCompletenessScore(transformerResult);

      // Determine if review is needed
      transformerResult.requiresReview = this.requiresReview(transformerResult);
      if (transformerResult.requiresReview) {
        transformerResult.reviewReason = this.getReviewReason(transformerResult);
      }

      const duration = Date.now() - startTime;
      logger.info('Document classified', {
        documentId,
        type: transformerResult.documentType,
        confidence: transformerResult.confidenceScore,
        duration,
      });

      return transformerResult;
    } catch (error) {
      logger.error('Classification failed', {
        documentId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * Classify using transformer model
   */
  private async classifyWithTransformer(
    text: string,
    metadata?: Record<string, unknown>
  ): Promise<ClassificationResult> {
    // In production, would call actual transformer model
    // For now, simulate classification

    const documentType = this.detectDocumentType(text);
    const confidence = this.calculateConfidence(text, documentType);

    return {
      documentType,
      confidenceScore: confidence,
      modelVersion: 'v2.1.0',
      modelType: 'transformer',
      extractedFields: this.extractFields(text, documentType),
      fieldConfidenceScores: {},
      qualityScore: 0.85,
      completenessScore: 0.80,
      requiresReview: confidence < 0.8,
    };
  }

  /**
   * Classify using deterministic rules
   */
  private async classifyWithDeterministic(text: string): Promise<ClassificationResult> {
    const documentType = this.detectDocumentType(text);
    
    return {
      documentType,
      confidenceScore: 0.6, // Lower confidence for deterministic
      modelVersion: 'deterministic-v1',
      modelType: 'deterministic',
      extractedFields: this.extractFieldsWithRegex(text, documentType),
      fieldConfidenceScores: {},
      qualityScore: 0.70,
      completenessScore: 0.65,
      requiresReview: true,
    };
  }

  /**
   * Combine transformer and deterministic results
   */
  private combineResults(
    transformer: ClassificationResult,
    deterministic: ClassificationResult
  ): ClassificationResult {
    // Use transformer result as base, fill in gaps from deterministic
    const combined: ClassificationResult = {
      ...transformer,
      modelType: 'hybrid',
    };

    // Fill missing fields from deterministic
    for (const [key, value] of Object.entries(deterministic.extractedFields)) {
      if (!combined.extractedFields[key] || combined.extractedFields[key].confidence < value.confidence) {
        combined.extractedFields[key] = value;
      }
    }

    // Use average confidence
    combined.confidenceScore = (transformer.confidenceScore + deterministic.confidenceScore) / 2;

    return combined;
  }

  /**
   * Enrich vendor information
   */
  private async enrichVendor(
    tenantId: string,
    vendorName: string
  ): Promise<{ name: string; confidence: number } | null> {
    const result = await db.query<{
      vendor_name: string;
      vat_number: string | null;
      confidence_score: number;
    }>(
      `SELECT vendor_name, vat_number, confidence_score
       FROM vendor_enrichment
       WHERE tenant_id = $1
         AND (vendor_name_normalized = $2 OR vendor_name = $2)
       ORDER BY confidence_score DESC
       LIMIT 1`,
      [tenantId, vendorName.toLowerCase().trim()]
    );

    if (result.rows.length > 0) {
      return {
        name: result.rows[0].vendor_name,
        confidence: result.rows[0].confidence_score || 0.8,
      };
    }

    return null;
  }

  /**
   * Generate tags for document
   */
  private async generateTags(tenantId: string, result: ClassificationResult): Promise<string[]> {
    const tags: string[] = [];

    if (result.documentType === DocumentType.INVOICE) {
      tags.push('invoice');
    } else if (result.documentType === DocumentType.RECEIPT) {
      tags.push('receipt');
    }

    if (result.recurringVendor) {
      tags.push('recurring');
    }

    if (result.taxAmount && result.taxAmount > 0) {
      tags.push('taxable');
    }

    if (result.complianceFlags && result.complianceFlags.length > 0) {
      tags.push('compliance-review');
    }

    return tags;
  }

  /**
   * Check if vendor is recurring
   */
  private async checkRecurringVendor(tenantId: string, vendorName?: string): Promise<boolean> {
    if (!vendorName) return false;

    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM classification_results
       WHERE tenant_id = $1
         AND vendor_name = $2
         AND created_at > NOW() - INTERVAL '90 days'
       GROUP BY vendor_name
       HAVING COUNT(*) >= 3`,
      [tenantId, vendorName]
    );

    return result.rows.length > 0;
  }

  /**
   * Suggest GL code
   */
  private async suggestGLCode(
    tenantId: string,
    result: ClassificationResult
  ): Promise<{ code: string; confidence: number }> {
    // Check feature store for GL code suggestions
    const featureResult = await db.query<{
      feature_metadata: unknown;
      confidence_threshold: number;
    }>(
      `SELECT feature_metadata, confidence_threshold
       FROM feature_store
       WHERE tenant_id = $1
         AND feature_type = 'gl_code_suggestion'
         AND feature_key = $2
         AND is_active = true
       LIMIT 1`,
      [tenantId, result.vendorName || 'default']
    );

    if (featureResult.rows.length > 0) {
      const metadata = featureResult.rows[0].feature_metadata as Record<string, unknown>;
      return {
        code: metadata.suggestedCode as string || '6000',
        confidence: featureResult.rows[0].confidence_threshold || 0.7,
      };
    }

    // Default suggestion based on document type
    const defaultCodes: Record<string, string> = {
      invoice: '5000', // Cost of Sales
      receipt: '6000', // Operating Expenses
    };

    return {
      code: defaultCodes[result.documentType] || '6000',
      confidence: 0.5,
    };
  }

  /**
   * Check compliance flags
   */
  private async checkCompliance(tenantId: string, result: ClassificationResult): Promise<string[]> {
    const flags: string[] = [];

    // Check for missing VAT number on EU invoices
    if (result.taxCountry && ['GB', 'IE', 'FR', 'DE'].includes(result.taxCountry)) {
      if (!result.extractedFields['vatNumber']?.value) {
        flags.push('missing_vat_number');
      }
    }

    // Check for suspicious amounts
    if (result.totalAmount && result.totalAmount > 100000) {
      flags.push('high_value_transaction');
    }

    return flags;
  }

  /**
   * Calculate quality score
   */
  private calculateQualityScore(result: ClassificationResult): number {
    let score = result.confidenceScore;

    // Penalize low field confidence
    const fieldConfidences = Object.values(result.fieldConfidenceScores);
    if (fieldConfidences.length > 0) {
      const avgFieldConfidence = fieldConfidences.reduce((a, b) => a + b, 0) / fieldConfidences.length;
      score = (score + avgFieldConfidence) / 2;
    }

    // Penalize missing critical fields
    const criticalFields = ['totalAmount', 'date', 'vendorName'];
    const missingFields = criticalFields.filter(f => !result.extractedFields[f]);
    score -= missingFields.length * 0.1;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate completeness score
   */
  private calculateCompletenessScore(result: ClassificationResult): number {
    const requiredFields = ['totalAmount', 'date', 'vendorName'];
    const optionalFields = ['taxAmount', 'lineItems', 'invoiceNumber'];

    const requiredPresent = requiredFields.filter(f => result.extractedFields[f]).length;
    const optionalPresent = optionalFields.filter(f => result.extractedFields[f]).length;

    const requiredScore = requiredPresent / requiredFields.length;
    const optionalScore = optionalPresent / optionalFields.length;

    return requiredScore * 0.7 + optionalScore * 0.3;
  }

  /**
   * Determine if review is needed
   */
  private requiresReview(result: ClassificationResult): boolean {
    if (result.confidenceScore < 0.8) return true;
    if (result.qualityScore && result.qualityScore < 0.7) return true;
    if (result.completenessScore && result.completenessScore < 0.6) return true;
    if (result.complianceFlags && result.complianceFlags.length > 0) return true;
    return false;
  }

  /**
   * Get review reason
   */
  private getReviewReason(result: ClassificationResult): string {
    const reasons: string[] = [];

    if (result.confidenceScore < 0.8) {
      reasons.push('Low confidence score');
    }
    if (result.qualityScore && result.qualityScore < 0.7) {
      reasons.push('Low quality score');
    }
    if (result.complianceFlags && result.complianceFlags.length > 0) {
      reasons.push('Compliance flags detected');
    }

    return reasons.join('; ');
  }

  /**
   * Detect document type from text
   */
  private detectDocumentType(text: string): DocumentType {
    const textLower = text.toLowerCase();

    if (textLower.includes('invoice') || textLower.includes('inv#')) {
      return DocumentType.INVOICE;
    }
    if (textLower.includes('receipt')) {
      return DocumentType.RECEIPT;
    }
    if (textLower.includes('statement')) {
      return DocumentType.STATEMENT;
    }
    if (textLower.includes('payslip') || textLower.includes('payroll')) {
      return DocumentType.PAYSLIP;
    }

    return DocumentType.OTHER;
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(text: string, documentType: DocumentType): number {
    // Simple confidence calculation
    let confidence = 0.5;

    const textLower = text.toLowerCase();
    const typeKeywords: Record<DocumentType, string[]> = {
      [DocumentType.INVOICE]: ['invoice', 'inv#', 'bill to', 'amount due'],
      [DocumentType.RECEIPT]: ['receipt', 'thank you', 'payment received'],
      [DocumentType.STATEMENT]: ['statement', 'account summary', 'balance'],
      [DocumentType.PAYSLIP]: ['payslip', 'payroll', 'gross pay', 'net pay'],
      [DocumentType.TAX_FORM]: ['tax form', 'irs', 'hmrc'],
      [DocumentType.OTHER]: [],
    };

    const keywords = typeKeywords[documentType];
    const matches = keywords.filter(kw => textLower.includes(kw)).length;
    confidence += (matches / keywords.length) * 0.3;

    // Boost confidence if text is substantial
    if (text.length > 500) {
      confidence += 0.1;
    }

    return Math.min(1, confidence);
  }

  /**
   * Extract fields using AI/transformer
   */
  private extractFields(text: string, documentType: DocumentType): Record<string, FieldExtraction> {
    const fields: Record<string, FieldExtraction> = {};

    // Extract total amount
    const totalMatch = text.match(/(?:total|amount due|balance)[\s:]*[\$£€]?[\s]*([\d,]+\.?\d*)/i);
    if (totalMatch) {
      fields.totalAmount = {
        value: parseFloat(totalMatch[1].replace(/,/g, '')),
        confidence: 0.85,
        source: 'regex',
      };
    }

    // Extract date
    const dateMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
    if (dateMatch) {
      fields.date = {
        value: dateMatch[1],
        confidence: 0.80,
        source: 'regex',
      };
    }

    // Extract vendor name (first line or after "from:")
    const vendorMatch = text.match(/(?:from|vendor|supplier)[\s:]*([A-Z][A-Za-z\s&]+)/i) || 
                       text.match(/^([A-Z][A-Za-z\s&]+)/);
    if (vendorMatch) {
      fields.vendorName = {
        value: vendorMatch[1].trim(),
        confidence: 0.75,
        source: 'regex',
      };
    }

    return fields;
  }

  /**
   * Extract fields using regex (deterministic fallback)
   */
  private extractFieldsWithRegex(text: string, documentType: DocumentType): Record<string, FieldExtraction> {
    // Similar to extractFields but with lower confidence
    const fields = this.extractFields(text, documentType);
    
    // Lower confidence for deterministic extraction
    for (const key in fields) {
      fields[key].confidence *= 0.8;
      fields[key].source = 'regex';
    }

    return fields;
  }

  /**
   * Save classification result
   */
  async saveClassificationResult(
    tenantId: string,
    documentId: string,
    ingestionLogId: string | null,
    result: ClassificationResult
  ): Promise<string> {
    const classificationId = randomUUID();

    await db.query(
      `INSERT INTO classification_results (
        id, tenant_id, document_id, ingestion_log_id, document_type,
        confidence_score, model_version, model_type, extracted_fields,
        field_confidence_scores, vendor_name, vendor_confidence,
        tax_amount, tax_rate, tax_type, tax_country, line_items,
        total_amount, currency, gl_code_suggestion, gl_code_confidence,
        compliance_flags, tags, recurring_vendor, quality_score,
        completeness_score, requires_review, review_reason,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
        $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20,
        $21, $22::jsonb, $23, $24, $25, $26, $27, $28, NOW(), NOW()
      )`,
      [
        classificationId,
        tenantId,
        documentId,
        ingestionLogId,
        result.documentType,
        result.confidenceScore,
        result.modelVersion,
        result.modelType,
        JSON.stringify(result.extractedFields),
        JSON.stringify(result.fieldConfidenceScores),
        result.vendorName,
        result.vendorConfidence,
        result.taxAmount,
        result.taxRate,
        result.taxType,
        result.taxCountry,
        JSON.stringify(result.lineItems || []),
        result.totalAmount,
        result.currency,
        result.glCodeSuggestion,
        result.glCodeConfidence,
        JSON.stringify(result.complianceFlags || []),
        result.tags || [],
        result.recurringVendor || false,
        result.qualityScore,
        result.completenessScore,
        result.requiresReview,
        result.reviewReason,
      ]
    );

    return classificationId;
  }
}

export const enhancedClassificationService = new EnhancedClassificationService();
