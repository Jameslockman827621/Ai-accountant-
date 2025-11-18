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
  entityType:
    | 'vendor'
    | 'customer'
    | 'amount'
    | 'date'
    | 'tax_id'
    | 'invoice_number'
    | 'currency'
    | 'other';
  entityValue: string;
  confidenceScore: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
  pageNumber?: number;
  normalizedValue?: string;
}

/**
 * Extract line items from document text (Chunk 3)
 */
type StructuredLineItem = {
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  total?: number | null;
  tax?: number | null;
  taxRate?: number | null;
};

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
      if (Array.isArray(structuredData.lineItems)) {
        const structuredItems = structuredData.lineItems.filter(
          (candidate): candidate is StructuredLineItem =>
            Boolean(candidate) && typeof candidate === 'object'
        );

        if (structuredItems.length > 0) {
          return this.processStructuredLineItems(documentId, structuredItems);
        }
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
    items: StructuredLineItem[]
  ): Promise<LineItem[]> {
    const lineItems: LineItem[] = [];

    items.forEach((item, index) => {
      if (!item) {
        return;
      }
      const lineNumber = index + 1;
      const description = typeof item.description === 'string' ? item.description : '';
      const quantity =
        typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 1;
      const unitPrice =
        typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice) ? item.unitPrice : 0;
      const totalAmount =
        typeof item.total === 'number' && Number.isFinite(item.total)
          ? item.total
          : unitPrice * quantity;
      const taxAmount = typeof item.tax === 'number' && Number.isFinite(item.tax) ? item.tax : 0;
      const taxRate =
        typeof item.taxRate === 'number' && Number.isFinite(item.taxRate) ? item.taxRate : 0;

      lineItems.push({
        lineNumber,
        description,
        quantity,
        unitPrice,
        totalAmount,
        taxAmount,
        taxRate,
        confidenceScore: 0.85, // Higher confidence for structured data
        rawText: description,
      });
    });

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
      const match = line.match(
        /(.+?)\s+(\d+(?:\.\d+)?)\s+([£$€]?\d+(?:\.\d+)?)\s+([£$€]?\d+(?:\.\d+)?)/
      );
      if (match) {
        const description = (match[1] ?? '').trim();
        const quantity = parseFloat(match[2] ?? '1');
        const unitPriceRaw = match[3] ?? '0';
        const totalRaw = match[4] ?? '0';

        lineItems.push({
          lineNumber: lineNumber++,
          description,
          quantity: Number.isFinite(quantity) ? quantity : 1,
          unitPrice: parseFloat(unitPriceRaw.replace(/[£$€]/g, '')),
          totalAmount: parseFloat(totalRaw.replace(/[£$€]/g, '')),
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
    if (typeof structuredData.vendor === 'string' && structuredData.vendor.trim().length > 0) {
      entities.push({
        entityType: 'vendor',
        entityValue: String(structuredData.vendor),
        confidenceScore: 0.9,
        normalizedValue: String(structuredData.vendor).toLowerCase().trim(),
      });
    }

    // Extract invoice number
    if (
      typeof structuredData.invoiceNumber === 'string' &&
      structuredData.invoiceNumber.trim().length > 0
    ) {
      entities.push({
        entityType: 'invoice_number',
        entityValue: String(structuredData.invoiceNumber),
        confidenceScore: 0.85,
        normalizedValue: String(structuredData.invoiceNumber).toUpperCase().trim(),
      });
    }

    // Extract date
    const rawDate = structuredData.date;
    if (rawDate instanceof Date) {
      const dateValue = rawDate.toISOString().split('T')[0];
      entities.push({
        entityType: 'date',
        entityValue: dateValue,
        confidenceScore: 0.9,
        normalizedValue: dateValue,
      });
    } else if (typeof rawDate === 'string' && rawDate.trim() !== '') {
      const dateValue = rawDate;
      entities.push({
        entityType: 'date',
        entityValue: dateValue,
        confidenceScore: 0.9,
        normalizedValue: dateValue,
      });
    }

    // Extract amount
    if (
      typeof structuredData.total === 'number' ||
      (typeof structuredData.total === 'string' && structuredData.total.trim() !== '')
    ) {
      entities.push({
        entityType: 'amount',
        entityValue: String(structuredData.total),
        confidenceScore: 0.9,
        normalizedValue: String(structuredData.total),
      });
    }

    // Extract currency
    if (typeof structuredData.currency === 'string' && structuredData.currency.trim() !== '') {
      entities.push({
        entityType: 'currency',
        entityValue: String(structuredData.currency),
        confidenceScore: 0.95,
        normalizedValue: String(structuredData.currency).toUpperCase(),
      });
    }

    // Extract tax ID from text
    const taxIdMatch = extractedText.match(/(?:VAT|Tax|EIN|SSN)[\s#:]*([A-Z0-9-]+)/i);
    if (taxIdMatch?.[1]) {
      const taxId = taxIdMatch[1];
      entities.push({
        entityType: 'tax_id',
        entityValue: taxId,
        confidenceScore: 0.8,
        normalizedValue: taxId.toUpperCase().trim(),
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
      const normalizedValue = entity.normalizedValue ?? entity.entityValue;
      const pageNumber = entity.pageNumber ?? null;

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
          pageNumber,
          normalizedValue,
        ]
      );
    }
  }
}

export const lineItemExtractor = new LineItemExtractor();
