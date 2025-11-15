import { randomUUID } from 'crypto';
import { db } from '@ai-accountant/database';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';

const logger = createLogger('assistant-service');

export type SuggestionSeverity = 'info' | 'warning' | 'critical';

export interface ReviewSuggestion {
  id: string;
  title: string;
  message: string;
  severity: SuggestionSeverity;
  recommendedAction?: string;
}

export async function getDocumentReviewSuggestions(
  tenantId: string,
  documentId: string
): Promise<ReviewSuggestion[]> {
  const result = await db.query<{
    id: string;
    file_name: string;
    document_type: string | null;
    confidence_score: number | null;
    extracted_data: Record<string, unknown> | null;
  }>(
    `SELECT id, file_name, document_type, confidence_score, extracted_data
     FROM documents
     WHERE id = $1 AND tenant_id = $2`,
    [documentId, tenantId]
  );

  if (result.rowCount === 0) {
    throw new ValidationError('Document not found');
  }

  const doc = result.rows[0];
  const suggestions: ReviewSuggestion[] = [];
  const confidence = doc.confidence_score ?? 0;
  const data = doc.extracted_data || {};

  if (confidence < 0.5) {
    suggestions.push({
      id: randomUUID(),
      title: 'Confidence is critically low',
      message: `The AI is only ${(confidence * 100).toFixed(0)}% confident about this extraction. Manual verification is required before posting.`,
      severity: 'critical',
      recommendedAction: 'Verify every extracted field before approving.',
    });
  } else if (confidence < 0.75) {
    suggestions.push({
      id: randomUUID(),
      title: 'Confidence below recommended threshold',
      message: `Confidence is ${(confidence * 100).toFixed(0)}%, so the AI flagged this document for review.`,
      severity: 'warning',
      recommendedAction: 'Spot-check vendor, total, and category before approving.',
    });
  }

  if (!data['vendor']) {
    suggestions.push({
      id: randomUUID(),
      title: 'Missing vendor',
      message: 'Vendor name is missing from the extracted data.',
      severity: 'warning',
      recommendedAction: 'Fill in the vendor field manually.',
    });
  }

  if (!data['date']) {
    suggestions.push({
      id: randomUUID(),
      title: 'Missing transaction date',
      message: 'No document date was extracted, which blocks ledger posting.',
      severity: 'warning',
      recommendedAction: 'Enter the document date.',
    });
  }

  const total = typeof data['total'] === 'number' ? data['total'] : Number(data['total'] || 0);
  const tax = typeof data['tax'] === 'number' ? data['tax'] : Number(data['tax'] || 0);

  if (total > 0 && !data['tax']) {
    suggestions.push({
      id: randomUUID(),
      title: 'Tax amount missing',
      message: 'Total amount is present but tax is missing. This can cause VAT discrepancies.',
      severity: 'info',
      recommendedAction: 'Add the VAT amount or confirm the item is zero-rated.',
    });
  } else if (total > 0 && tax > total * 0.35) {
    suggestions.push({
      id: randomUUID(),
      title: 'Tax amount looks high',
      message: `Tax (£${tax.toFixed(2)}) is more than 35% of the total (£${total.toFixed(2)}).`,
      severity: 'warning',
      recommendedAction: 'Double-check the tax basis and rate.',
    });
  }

  if ((doc.document_type === 'invoice' || doc.document_type === 'receipt') && !data['invoiceNumber']) {
    suggestions.push({
      id: randomUUID(),
      title: 'Invoice number missing',
      message: 'Invoices should include an invoice number for audit tracking.',
      severity: 'info',
      recommendedAction: 'Enter the invoice number from the source document.',
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: randomUUID(),
      title: 'No blocking issues found',
      message: 'The assistant did not detect additional issues beyond the automated checks.',
      severity: 'info',
    });
  }

  logger.debug('Generated review suggestions', { documentId, count: suggestions.length });
  return suggestions;
}
