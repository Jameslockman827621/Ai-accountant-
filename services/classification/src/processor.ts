import OpenAI from 'openai';
import { createLogger } from '@ai-accountant/shared-utils';
import { DocumentType, ExtractedData } from '@ai-accountant/shared-types';

const logger = createLogger('classification-service');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL_VERSION = process.env.OPENAI_MODEL || 'gpt-4';

interface ClassificationResult {
  documentType: DocumentType;
  extractedData: ExtractedData;
  confidenceScore: number;
}

export async function processClassificationJob(extractedText: string): Promise<ClassificationResult> {
  try {
    // First, try to classify using keywords (fast path)
    const quickClassification = quickClassify(extractedText);
    if (quickClassification.confidenceScore > 0.8) {
      return quickClassification;
    }

    // Use LLM for more accurate classification
    return await llmClassify(extractedText);
  } catch (error) {
    logger.error('Classification failed', error instanceof Error ? error : new Error(String(error)));
    // Fallback to generic classification
    return {
      documentType: DocumentType.OTHER,
      extractedData: {},
      confidenceScore: 0.5,
    };
  }
}

function quickClassify(text: string): ClassificationResult {
  const lowerText = text.toLowerCase();

  // Invoice indicators
  if (
    lowerText.includes('invoice') ||
    lowerText.includes('invoice number') ||
    lowerText.includes('bill to') ||
    lowerText.includes('due date')
  ) {
    return {
      documentType: DocumentType.INVOICE,
      extractedData: extractInvoiceData(text),
      confidenceScore: 0.85,
    };
  }

  // Receipt indicators
  if (
    lowerText.includes('receipt') ||
    lowerText.includes('thank you for your purchase') ||
    lowerText.includes('total paid')
  ) {
    return {
      documentType: DocumentType.RECEIPT,
      extractedData: extractReceiptData(text),
      confidenceScore: 0.85,
    };
  }

  // Statement indicators
  if (
    lowerText.includes('statement') ||
    lowerText.includes('account statement') ||
    lowerText.includes('balance brought forward')
  ) {
    return {
      documentType: DocumentType.STATEMENT,
      extractedData: {},
      confidenceScore: 0.85,
    };
  }

  // Payslip indicators
  if (
    lowerText.includes('payslip') ||
    lowerText.includes('pay stub') ||
    lowerText.includes('gross pay') ||
    lowerText.includes('net pay')
  ) {
    return {
      documentType: DocumentType.PAYSLIP,
      extractedData: {},
      confidenceScore: 0.85,
    };
  }

  return {
    documentType: DocumentType.OTHER,
    extractedData: {},
    confidenceScore: 0.5,
  };
}

async function llmClassify(text: string): Promise<ClassificationResult> {
  const { extractStructuredFields } = await import('./fieldExtraction');
  const prompt = `Classify this document and extract key information. The document text is:

${text.substring(0, 2000)}

Respond with JSON only:
{
  "documentType": "invoice" | "receipt" | "statement" | "payslip" | "tax_form" | "other",
  "vendor": "vendor name or null",
  "date": "YYYY-MM-DD or null",
  "total": number or null,
  "tax": number or null,
  "taxRate": number or null,
  "currency": "currency code or null",
  "category": "expense category or null",
  "description": "brief description or null",
  "invoiceNumber": "invoice number or null",
  "confidenceScore": number between 0 and 1
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_VERSION,
      messages: [
        {
          role: 'system',
          content: 'You are a document classification expert. Always respond with valid JSON only, no other text.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from LLM');
    }

    const result = JSON.parse(response);
    
    // Merge with structured extraction
    const structuredData = await extractStructuredFields(text, result.documentType || 'unknown');
    
    const extractedData: ExtractedData = {
      ...structuredData,
      currency: result.currency || structuredData.currency || 'GBP',
    };
    
    // Override with classification result if provided
    if (result.vendor) extractedData.vendor = result.vendor;
    if (result.date) {
      try {
        extractedData.date = new Date(result.date);
      } catch {
        // Keep structured date if classification date invalid
      }
    }
    if (result.total !== null && result.total !== undefined) {
      extractedData.total = typeof result.total === 'number' ? result.total : parseFloat(String(result.total));
    }
    if (result.tax !== null && result.tax !== undefined) {
      extractedData.tax = typeof result.tax === 'number' ? result.tax : parseFloat(String(result.tax));
    }
    if (result.taxRate !== null && result.taxRate !== undefined) {
      extractedData.taxRate = typeof result.taxRate === 'number' ? result.taxRate : parseFloat(String(result.taxRate));
    }
    if (result.category) extractedData.category = result.category;
    if (result.description) extractedData.description = result.description;
    if (result.invoiceNumber) extractedData.invoiceNumber = result.invoiceNumber;

    return {
      documentType: mapDocumentType(result.documentType),
      extractedData,
      confidenceScore: result.confidenceScore || 0.7,
    };
  } catch (error) {
    logger.error('LLM classification failed', error instanceof Error ? error : new Error(String(error)));
    return {
      documentType: DocumentType.OTHER,
      extractedData: {},
      confidenceScore: 0.5,
    };
  }
}

function mapDocumentType(type: string): DocumentType {
  const mapping: Record<string, DocumentType> = {
    invoice: DocumentType.INVOICE,
    receipt: DocumentType.RECEIPT,
    statement: DocumentType.STATEMENT,
    payslip: DocumentType.PAYSLIP,
    tax_form: DocumentType.TAX_FORM,
    other: DocumentType.OTHER,
  };
  return mapping[type.toLowerCase()] || DocumentType.OTHER;
}

function extractInvoiceData(text: string): ExtractedData {
  // Simple regex-based extraction
  const invoiceNumberMatch = text.match(/(?:invoice|inv)[\s#:]*([A-Z0-9-]+)/i);
  const dateMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  const totalMatch = text.match(/(?:total|amount)[\s:£$]*([\d,]+\.?\d*)/i);
  const taxMatch = text.match(/(?:vat|tax)[\s:£$]*([\d,]+\.?\d*)/i);

  const data: ExtractedData = {
    currency: 'GBP',
  };
  
  if (invoiceNumberMatch?.[1]) {
    data.invoiceNumber = invoiceNumberMatch[1];
  }
  if (dateMatch?.[1]) {
    data.date = new Date(dateMatch[1]);
  }
  if (totalMatch?.[1]) {
    data.total = parseFloat(totalMatch[1].replace(/,/g, ''));
  }
  if (taxMatch?.[1]) {
    data.tax = parseFloat(taxMatch[1].replace(/,/g, ''));
  }
  
  return data;
}

function extractReceiptData(text: string): ExtractedData {
  const dateMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  const totalMatch = text.match(/(?:total|paid)[\s:£$]*([\d,]+\.?\d*)/i);

  const data: ExtractedData = {
    currency: 'GBP',
  };
  
  if (dateMatch?.[1]) {
    data.date = new Date(dateMatch[1]);
  }
  if (totalMatch?.[1]) {
    data.total = parseFloat(totalMatch[1].replace(/,/g, ''));
  }
  
  return data;
}
