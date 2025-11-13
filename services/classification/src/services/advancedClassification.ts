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
  const combined: Record<string, number> = {};

  results.forEach((result, index) => {
    const weight = weights[index];
    if (!combined[result.documentType]) {
      combined[result.documentType] = 0;
    }
    combined[result.documentType] += result.confidence * weight;
  });

  const bestType = Object.entries(combined).reduce((a, b) => 
    combined[a[0]] > combined[b[0]] ? a : b
  )[0] as DocumentType;

  const confidence = combined[bestType];

  return {
    documentType: bestType,
    confidence: Math.min(confidence, 0.99),
    reasoning: `Ensemble classification: ${results.map(r => `${r.documentType}(${r.confidence.toFixed(2)})`).join(', ')}`,
    alternativeTypes: Object.entries(combined)
      .filter(([type]) => type !== bestType)
      .map(([type, conf]) => ({ type: type as DocumentType, confidence: conf }))
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
          content: 'You are an expert at classifying financial documents. Be precise and confident.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
    return {
      documentType: (result.type || 'other') as DocumentType,
      confidence: Math.min(Math.max(result.confidence || 0.5, 0), 1),
    };
  } catch (error) {
    logger.error('GPT-4 classification failed', error);
    return { documentType: 'other', confidence: 0.5 };
  }
}

function classifyWithHeuristics(
  text: string,
  fileName: string,
  fileType: string
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
    return { documentType: 'invoice', confidence: 0.85 };
  }

  // Receipt indicators
  if (
    lowerText.includes('receipt') ||
    lowerText.includes('thank you for your purchase') ||
    lowerFileName.includes('receipt') ||
    (lowerText.includes('payment method') && lowerText.includes('total'))
  ) {
    return { documentType: 'receipt', confidence: 0.85 };
  }

  // Statement indicators
  if (
    lowerText.includes('statement') ||
    lowerText.includes('account statement') ||
    lowerText.includes('balance brought forward') ||
    lowerFileName.includes('statement')
  ) {
    return { documentType: 'statement', confidence: 0.85 };
  }

  // Payslip indicators
  if (
    lowerText.includes('payslip') ||
    lowerText.includes('pay slip') ||
    lowerText.includes('gross pay') ||
    lowerText.includes('net pay') ||
    lowerText.includes('tax code')
  ) {
    return { documentType: 'payslip', confidence: 0.90 };
  }

  // Tax form indicators
  if (
    lowerText.includes('hmrc') ||
    lowerText.includes('self assessment') ||
    lowerText.includes('tax return') ||
    lowerText.includes('corporation tax')
  ) {
    return { documentType: 'tax_form', confidence: 0.90 };
  }

  return { documentType: 'other', confidence: 0.5 };
}

function classifyWithKeywords(
  text: string,
  fileName: string
): { documentType: DocumentType; confidence: number } {
  const keywords: Record<DocumentType, string[]> = {
    invoice: ['invoice', 'bill', 'charge', 'amount due', 'payment terms'],
    receipt: ['receipt', 'paid', 'payment received', 'transaction'],
    statement: ['statement', 'balance', 'account summary', 'transactions'],
    payslip: ['payslip', 'salary', 'wages', 'deductions', 'ni'],
    tax_form: ['tax', 'hmrc', 'return', 'liability', 'allowance'],
    other: [],
  };

  const lowerText = text.toLowerCase();
  const scores: Record<DocumentType, number> = {
    invoice: 0,
    receipt: 0,
    statement: 0,
    payslip: 0,
    tax_form: 0,
    other: 0,
  };

  Object.entries(keywords).forEach(([type, words]) => {
    words.forEach(word => {
      if (lowerText.includes(word)) {
        scores[type as DocumentType] += 1;
      }
    });
  });

  const bestType = Object.entries(scores).reduce((a, b) => 
    scores[a[0] as DocumentType] > scores[b[0] as DocumentType] ? a : b
  )[0] as DocumentType;

  const maxScore = Math.max(...Object.values(scores));
  const confidence = maxScore > 0 ? Math.min(maxScore / 5, 0.8) : 0.3;

  return { documentType: bestType, confidence };
}
