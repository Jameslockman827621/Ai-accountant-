import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { DocumentType } from '@ai-accountant/shared-types';

const logger = createLogger('line-item-extraction');

export interface LineItem {
  lineNumber: number;
  description: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  taxAmount: number;
  taxRate: number;
  accountCode?: string;
  category?: string;
  vendorName?: string;
  confidenceScore: number;
  rawText: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface ExtractedEntity {
  entityType: 'vendor' | 'customer' | 'amount' | 'date' | 'tax_id' | 'invoice_number' | 'currency' | 'other';
  entityValue: string;
  confidenceScore: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
  pageNumber?: number;
  normalizedValue?: string;
}

/**
 * Extract line items from document text (Chunk 3)
 */
export class LineItemExtractor {
  /**
   * Extract line items from classified document
   */
  async extractLineItems(
    documentId: string,
    documentType: DocumentType,
    extractedText: string,
    structuredData: Record<string, unknown>
  ): Promise<LineItem[]> {
    if (documentType !== DocumentType.INVOICE && documentType !== DocumentType.RECEIPT) {
      return [];
    }

    try {
      // Try to extract from structured data first
      if (structuredData.lineItems && Array.isArray(structuredData.lineItems)) {
        return this.processStructuredLineItems(documentId, structuredData.lineItems as any[]);
      }

      // Fallback to text parsing
      return this.parseLineItemsFromText(extractedText);
    } catch (error) {
      logger.error('Line item extraction failed', {
        documentId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return [];
    }
  }

  /**
   * Process structured line items from ML extraction
   */
  private async processStructuredLineItems(
    documentId: string,
    items: Array<{
      description?: string;
      quantity?: number;
      unitPrice?: number;
      total?: number;
      tax?: number;
      taxRate?: number;
    }>
  ): Promise<LineItem[]> {
    const lineItems: LineItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const lineNumber = i + 1;

      lineItems.push({
        lineNumber,
        description: item.description || '',
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        totalAmount: item.total || (item.unitPrice || 0) * (item.quantity || 1),
        taxAmount: item.tax || 0,
        taxRate: item.taxRate || 0,
        confidenceScore: 0.85, // Higher confidence for structured data
        rawText: item.description || '',
      });
    }

    // Store in database
    await this.storeLineItems(documentId, lineItems);

    return lineItems;
  }

  /**
   * Parse line items from text (fallback)
   */
  private parseLineItemsFromText(text: string): LineItem[] {
    const lineItems: LineItem[] = [];
    const lines = text.split('\n');

    let lineNumber = 1;
    for (const line of lines) {
      // Look for patterns like: "Item Description | Qty | Price | Total"
      const match = line.match(/(.+?)\s+(\d+(?:\.\d+)?)\s+([£$€]?\d+(?:\.\d+)?)\s+([£$€]?\d+(?:\.\d+)?)/);
      if (match) {
        lineItems.push({
          lineNumber: lineNumber++,
          description: match[1].trim(),
          quantity: parseFloat(match[2]),
          unitPrice: parseFloat(match[3].replace(/[£$€]/g, '')),
          totalAmount: parseFloat(match[4].replace(/[£$€]/g, '')),
          taxAmount: 0,
          taxRate: 0,
          confidenceScore: 0.7,
          rawText: line,
        });
      }
    }

    return lineItems;
  }

  /**
   * Store line items in database
   */
  private async storeLineItems(documentId: string, lineItems: LineItem[]): Promise<void> {
    for (const item of lineItems) {
      await db.query(
        `INSERT INTO document_line_items (
          id, document_id, line_number, description, quantity,
          unit_price, total_amount, tax_amount, tax_rate,
          account_code, category, vendor_name, confidence_score,
          raw_text, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
        )`,
        [
          documentId,
          item.lineNumber,
          item.description,
          item.quantity,
          item.unitPrice,
          item.totalAmount,
          item.taxAmount,
          item.taxRate,
          item.accountCode || null,
          item.category || null,
          item.vendorName || null,
          item.confidenceScore,
          item.rawText,
        ]
      );
    }
  }

  /**
   * Extract entities from document (Chunk 3)
   */
  async extractEntities(
    documentId: string,
    extractedText: string,
    structuredData: Record<string, unknown>
  ): Promise<ExtractedEntity[]> {
    const entities: ExtractedEntity[] = [];

    // Extract vendor
    if (structuredData.vendor) {
      entities.push({
        entityType: 'vendor',
        entityValue: String(structuredData.vendor),
        confidenceScore: 0.9,
        normalizedValue: String(structuredData.vendor).toLowerCase().trim(),
      });
    }

    // Extract invoice number
    if (structuredData.invoiceNumber) {
      entities.push({
        entityType: 'invoice_number',
        entityValue: String(structuredData.invoiceNumber),
        confidenceScore: 0.85,
        normalizedValue: String(structuredData.invoiceNumber).toUpperCase().trim(),
      });
    }

    // Extract date
    if (structuredData.date) {
      const dateValue = structuredData.date instanceof Date
        ? structuredData.date.toISOString().split('T')[0]
        : String(structuredData.date);
      entities.push({
        entityType: 'date',
        entityValue: dateValue,
        confidenceScore: 0.9,
        normalizedValue: dateValue,
      });
    }

    // Extract amount
    if (structuredData.total) {
      entities.push({
        entityType: 'amount',
        entityValue: String(structuredData.total),
        confidenceScore: 0.9,
        normalizedValue: String(structuredData.total),
      });
    }

    // Extract currency
    if (structuredData.currency) {
      entities.push({
        entityType: 'currency',
        entityValue: String(structuredData.currency),
        confidenceScore: 0.95,
        normalizedValue: String(structuredData.currency).toUpperCase(),
      });
    }

    // Extract tax ID from text
    const taxIdMatch = extractedText.match(/(?:VAT|Tax|EIN|SSN)[\s#:]*([A-Z0-9-]+)/i);
    if (taxIdMatch) {
      entities.push({
        entityType: 'tax_id',
        entityValue: taxIdMatch[1],
        confidenceScore: 0.8,
        normalizedValue: taxIdMatch[1].toUpperCase().trim(),
      });
    }

    // Store entities
    await this.storeEntities(documentId, entities);

    return entities;
  }

  /**
   * Store entities in database
   */
  private async storeEntities(documentId: string, entities: ExtractedEntity[]): Promise<void> {
    for (const entity of entities) {
      await db.query(
        `INSERT INTO document_entities (
          id, document_id, entity_type, entity_value, confidence_score,
          bounding_box, page_number, normalized_value, validation_status,
          extraction_method, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6, $7, 'pending', 'ml', NOW(), NOW()
        )`,
        [
          documentId,
          entity.entityType,
          entity.entityValue,
          entity.confidenceScore,
          entity.boundingBox ? JSON.stringify(entity.boundingBox) : null,
          entity.pageNumber || null,
          entity.normalizedValue || entity.entityValue,
        ]
      );
    }
  }
}

export const lineItemExtractor = new LineItemExtractor();
