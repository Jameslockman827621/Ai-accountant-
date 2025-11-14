import OpenAI from 'openai';
import { createLogger } from '@ai-accountant/shared-utils';
import { ExtractedData } from '@ai-accountant/shared-types';

const logger = createLogger('classification-service');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL_VERSION = process.env.OPENAI_MODEL || 'gpt-4';

/**
 * Extract structured fields from document text using LLM
 */
export async function extractStructuredFields(
  extractedText: string,
  documentType: string
): Promise<ExtractedData> {
  logger.info('Extracting structured fields', { documentType });

  const prompt = `Extract structured financial data from this document text. The document type is: ${documentType}

Document text:
${extractedText.substring(0, 4000)}

Extract the following fields and return as JSON:
{
  "vendor": "vendor/supplier name or null",
  "date": "YYYY-MM-DD or null",
  "total": number or null,
  "tax": number or null,
  "taxRate": number between 0 and 1 or null,
  "currency": "currency code (default: GBP) or null",
  "category": "expense category or null",
  "description": "brief description or null",
  "invoiceNumber": "invoice number or null (for invoices)",
  "dueDate": "YYYY-MM-DD or null (for invoices)",
  "paymentMethod": "payment method or null",
  "lineItems": [
    {"description": "item description", "quantity": number, "unitPrice": number, "total": number}
  ] or null
}

Be precise with numbers. If a field cannot be determined, use null.`;

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_VERSION,
      messages: [
        {
          role: 'system',
          content: 'You are a financial data extraction expert. Extract precise structured data from documents. Always respond with valid JSON only, no other text.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from LLM');
    }

    const extracted = JSON.parse(response) as Record<string, unknown>;

    // Normalize and validate
    const data: ExtractedData = {
      currency: (extracted.currency as string) || 'GBP',
    };

    if (extracted.vendor) {
      data.vendor = String(extracted.vendor);
    }

    if (extracted.date) {
      try {
        data.date = new Date(String(extracted.date));
      } catch {
        // Invalid date, skip
      }
    }

    if (extracted.total !== null && extracted.total !== undefined) {
      data.total = typeof extracted.total === 'number' ? extracted.total : parseFloat(String(extracted.total || '0'));
    }

    if (extracted.tax !== null && extracted.tax !== undefined) {
      data.tax = typeof extracted.tax === 'number' ? extracted.tax : parseFloat(String(extracted.tax || '0'));
    }

    if (extracted.taxRate !== null && extracted.taxRate !== undefined) {
      data.taxRate = typeof extracted.taxRate === 'number' ? extracted.taxRate : parseFloat(String(extracted.taxRate || '0'));
    }

    if (extracted.category) {
      data.category = String(extracted.category);
    }

    if (extracted.description) {
      data.description = String(extracted.description);
    }

    if (extracted.invoiceNumber) {
      data.invoiceNumber = String(extracted.invoiceNumber);
    }

    if (extracted.dueDate) {
      try {
        data.dueDate = new Date(String(extracted.dueDate));
      } catch {
        // Invalid date, skip
      }
    }

    if (extracted.paymentMethod) {
      data.paymentMethod = String(extracted.paymentMethod);
    }

    if (extracted.lineItems && Array.isArray(extracted.lineItems)) {
      data.lineItems = extracted.lineItems as Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        total: number;
      }>;
    }

    logger.info('Structured fields extracted', {
      documentType,
      fieldsExtracted: Object.keys(data).length,
    });

    return data;
  } catch (error) {
    logger.error('Structured field extraction failed', error instanceof Error ? error : new Error(String(error)));
    
    // Return minimal data
    return {
      currency: 'GBP',
    };
  }
}
