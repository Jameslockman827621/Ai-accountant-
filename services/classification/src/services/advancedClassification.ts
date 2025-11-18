import OpenAI from 'openai';
import { createLogger } from '@ai-accountant/shared-utils';
import { DocumentType } from '@ai-accountant/shared-types';

const logger = createLogger('classification-service');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ClassificationResult {
  documentType: DocumentType;
  confidence: number;
  reasoning: string;
  alternativeTypes: Array<{ type: DocumentType; confidence: number }>;
}

export async function classifyDocumentAdvanced(
  text: string,
  fileName: string,
  fileType: string
): Promise<ClassificationResult> {
  // Multi-model ensemble approach
  const results = await Promise.all([
    classifyWithGPT4(text, fileName, fileType),
    classifyWithHeuristics(text, fileName, fileType),
    classifyWithKeywords(text, fileName),
  ]);

  // Weighted ensemble
  const weights = [0.6, 0.2, 0.2];
  const combined = new Map<DocumentType, number>();

  results.forEach((result, index) => {
    const weight = weights[index] ?? 0;
    combined.set(
      result.documentType,
      (combined.get(result.documentType) ?? 0) + result.confidence * weight
    );
  });

  const [bestType, bestConfidence] = Array.from(combined.entries()).reduce<[DocumentType, number]>(
    (best, entry) => (entry[1] > best[1] ? entry : best),
    [DocumentType.OTHER, 0]
  );

  return {
    documentType: bestType,
    confidence: Math.min(bestConfidence, 0.99),
    reasoning: `Ensemble classification: ${results.map((r) => `${r.documentType}(${r.confidence.toFixed(2)})`).join(', ')}`,
    alternativeTypes: Array.from(combined.entries())
      .filter(([type]) => type !== bestType)
      .map(([type, conf]) => ({ type, confidence: conf }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3),
  };
}

async function classifyWithGPT4(
  text: string,
  fileName: string,
  fileType: string
): Promise<{ documentType: DocumentType; confidence: number }> {
  const prompt = `Classify this financial document. File: ${fileName}, Type: ${fileType}
  
Text preview: ${text.substring(0, 2000)}

Return JSON: {"type": "invoice|receipt|statement|payslip|tax_form|other", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content:
            'You are an expert at classifying financial documents. Be precise and confident.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
    return {
      documentType: normalizeDocumentTypeInput(result.type),
      confidence: Math.min(Math.max(result.confidence || 0.5, 0), 1),
    };
  } catch (error) {
    logger.error('GPT-4 classification failed', error);
    return { documentType: DocumentType.OTHER, confidence: 0.5 };
  }
}

function classifyWithHeuristics(
  text: string,
  fileName: string,
  _fileType: string
): { documentType: DocumentType; confidence: number } {
  const lowerText = text.toLowerCase();
  const lowerFileName = fileName.toLowerCase();

  // Invoice indicators
  if (
    lowerText.includes('invoice') ||
    lowerText.includes('invoice number') ||
    lowerText.includes('invoice no') ||
    lowerFileName.includes('invoice') ||
    (lowerText.includes('due date') && lowerText.includes('total'))
  ) {
    return { documentType: DocumentType.INVOICE, confidence: 0.85 };
  }

  // Receipt indicators
  if (
    lowerText.includes('receipt') ||
    lowerText.includes('thank you for your purchase') ||
    lowerFileName.includes('receipt') ||
    (lowerText.includes('payment method') && lowerText.includes('total'))
  ) {
    return { documentType: DocumentType.RECEIPT, confidence: 0.85 };
  }

  // Statement indicators
  if (
    lowerText.includes('statement') ||
    lowerText.includes('account statement') ||
    lowerText.includes('balance brought forward') ||
    lowerFileName.includes('statement')
  ) {
    return { documentType: DocumentType.STATEMENT, confidence: 0.85 };
  }

  // Payslip indicators
  if (
    lowerText.includes('payslip') ||
    lowerText.includes('pay slip') ||
    lowerText.includes('gross pay') ||
    lowerText.includes('net pay') ||
    lowerText.includes('tax code')
  ) {
    return { documentType: DocumentType.PAYSLIP, confidence: 0.9 };
  }

  // Tax form indicators
  if (
    lowerText.includes('hmrc') ||
    lowerText.includes('self assessment') ||
    lowerText.includes('tax return') ||
    lowerText.includes('corporation tax')
  ) {
    return { documentType: DocumentType.TAX_FORM, confidence: 0.9 };
  }

  return { documentType: DocumentType.OTHER, confidence: 0.5 };
}

function classifyWithKeywords(
  text: string,
  _fileName: string
): { documentType: DocumentType; confidence: number } {
  const keywords: Record<DocumentType, string[]> = {
    [DocumentType.INVOICE]: ['invoice', 'bill', 'charge', 'amount due', 'payment terms'],
    [DocumentType.RECEIPT]: ['receipt', 'paid', 'payment received', 'transaction'],
    [DocumentType.STATEMENT]: ['statement', 'balance', 'account summary', 'transactions'],
    [DocumentType.PAYSLIP]: ['payslip', 'salary', 'wages', 'deductions', 'ni'],
    [DocumentType.TAX_FORM]: ['tax', 'hmrc', 'return', 'liability', 'allowance'],
    [DocumentType.OTHER]: [],
  };

  const lowerText = text.toLowerCase();
  const scores: Record<DocumentType, number> = {
    [DocumentType.INVOICE]: 0,
    [DocumentType.RECEIPT]: 0,
    [DocumentType.STATEMENT]: 0,
    [DocumentType.PAYSLIP]: 0,
    [DocumentType.TAX_FORM]: 0,
    [DocumentType.OTHER]: 0,
  };

  (Object.entries(keywords) as Array<[DocumentType, string[]]>).forEach(([type, words]) => {
    words.forEach((word) => {
      if (lowerText.includes(word)) {
        scores[type] += 1;
      }
    });
  });

  const bestType = (Object.keys(scores) as DocumentType[]).reduce(
    (best, current) => (scores[current] > scores[best] ? current : best),
    DocumentType.OTHER
  );

  const maxScore = Math.max(...Object.values(scores));
  const confidence = maxScore > 0 ? Math.min(maxScore / 5, 0.8) : 0.3;

  return { documentType: bestType, confidence };
}

const DOCUMENT_TYPE_VALUES = Object.values(DocumentType);

function normalizeDocumentTypeInput(value: unknown): DocumentType {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    const match = DOCUMENT_TYPE_VALUES.find((type) => type === lower);
    if (match) {
      return match as DocumentType;
    }
  }
  return DocumentType.OTHER;
}
