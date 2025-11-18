import OpenAI from 'openai';
import { createLogger } from '@ai-accountant/shared-utils';
import { ExtractedData, LineItem as SharedLineItem } from '@ai-accountant/shared-types';

type StructuredLineItem = {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
  tax?: number;
  category?: string;
};

const logger = createLogger('classification-field-extraction');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL_VERSION = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export async function extractStructuredFields(
  extractedText: string,
  documentType: string
): Promise<ExtractedData> {
  logger.info('Extracting structured fields', { documentType });

  const prompt = `Extract structured financial data from this document text. The document type is: ${documentType}

Document text:
${extractedText.substring(0, 4000)}

Return JSON with:
{
  "vendor": "vendor or null",
  "date": "YYYY-MM-DD or null",
  "total": number or null,
  "tax": number or null,
  "taxRate": number between 0 and 1 or null,
  "currency": "currency code (default GBP) or null",
  "category": "expense category or null",
  "description": "string or null",
  "invoiceNumber": "invoice number or null",
  "dueDate": "YYYY-MM-DD or null",
  "paymentMethod": "string or null",
  "lineItems": [
    {"description": "item description", "quantity": number, "unitPrice": number, "total": number}
  ] or null
}

Respond with JSON only.`;

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_VERSION,
      messages: [
        {
          role: 'system',
          content:
            'You are a financial document extraction expert. Always respond with valid JSON only, no extra commentary.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    const extracted = JSON.parse(response) as Record<string, unknown>;
    return normalizeExtractedData(extracted);
  } catch (error) {
    logger.error(
      'Structured field extraction failed',
      error instanceof Error ? error : new Error(String(error))
    );

    return {
      currency: 'GBP',
    };
  }
}

function normalizeExtractedData(extracted: Record<string, unknown>): ExtractedData {
  const data: ExtractedData = {
    currency: (typeof extracted.currency === 'string' && extracted.currency) || 'GBP',
  };

  if (typeof extracted.vendor === 'string') {
    data.vendor = extracted.vendor;
  }

  if (extracted.date) {
    const dateValue = typeof extracted.date === 'string' ? extracted.date : String(extracted.date);
    const parsedDate = new Date(dateValue);
    if (!Number.isNaN(parsedDate.getTime())) {
      data.date = parsedDate;
    }
  }

  if (extracted.total !== null && extracted.total !== undefined) {
    data.total =
      typeof extracted.total === 'number'
        ? extracted.total
        : parseFloat(String(extracted.total ?? '0'));
  }

  if (extracted.tax !== null && extracted.tax !== undefined) {
    data.tax =
      typeof extracted.tax === 'number' ? extracted.tax : parseFloat(String(extracted.tax ?? '0'));
  }

  if (extracted.taxRate !== null && extracted.taxRate !== undefined) {
    data.taxRate =
      typeof extracted.taxRate === 'number'
        ? extracted.taxRate
        : parseFloat(String(extracted.taxRate ?? '0'));
  }

  if (typeof extracted.category === 'string') {
    data.category = extracted.category;
  }

  if (typeof extracted.description === 'string') {
    data.description = extracted.description;
  }

  if (typeof extracted.invoiceNumber === 'string') {
    data.invoiceNumber = extracted.invoiceNumber;
  }

  if (Array.isArray(extracted.lineItems)) {
    const normalizedLineItems: SharedLineItem[] = extracted.lineItems
      .filter((lineItem): lineItem is StructuredLineItem => {
        return (
          lineItem !== null &&
          typeof lineItem === 'object' &&
          typeof (lineItem as { description?: unknown }).description === 'string'
        );
      })
      .map((item) => {
        const description = item.description ?? '';
        const totalValue =
          typeof item.total === 'number' && Number.isFinite(item.total)
            ? item.total
            : parseFloat(String(item.total ?? '0'));
        const quantityValue =
          typeof item.quantity === 'number' && Number.isFinite(item.quantity)
            ? item.quantity
            : undefined;
        const unitPriceValue =
          typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice)
            ? item.unitPrice
            : undefined;
        const taxValue =
          typeof item.tax === 'number' && Number.isFinite(item.tax) ? item.tax : undefined;
        const categoryValue =
          typeof item.category === 'string' && item.category.trim() !== ''
            ? item.category
            : undefined;

        const normalized: SharedLineItem = {
          description,
          total: Number.isFinite(totalValue) ? totalValue : 0,
        };
        if (quantityValue !== undefined) {
          normalized.quantity = quantityValue;
        }
        if (unitPriceValue !== undefined) {
          normalized.unitPrice = unitPriceValue;
        }
        if (taxValue !== undefined) {
          normalized.tax = taxValue;
        }
        if (categoryValue) {
          normalized.category = categoryValue;
        }
        return normalized;
      });

    if (normalizedLineItems.length > 0) {
      data.lineItems = normalizedLineItems;
    }
  }

  return data;
}
