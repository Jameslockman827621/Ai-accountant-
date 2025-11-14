import OpenAI from 'openai';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('classification-service');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// UK standard expense categories
export const EXPENSE_CATEGORIES = {
  'Travel': ['fuel', 'parking', 'train', 'taxi', 'hotel', 'flight'],
  'Meals': ['restaurant', 'lunch', 'dinner', 'cafe', 'coffee'],
  'Office': ['stationery', 'printer', 'computer', 'software', 'internet'],
  'Professional': ['accountant', 'legal', 'consultant', 'advisor'],
  'Marketing': ['advertising', 'promotion', 'website', 'social media'],
  'Utilities': ['electricity', 'gas', 'water', 'phone', 'broadband'],
  'Rent': ['office rent', 'premises', 'lease'],
  'Insurance': ['business insurance', 'liability', 'professional indemnity'],
  'Training': ['course', 'training', 'education', 'certification'],
  'Subscriptions': ['software subscription', 'membership', 'license'],
} as const;

export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

export interface CategorizationResult {
  category: ExpenseCategory | 'Other';
  confidence: number;
  reasoning: string;
  suggestedAccountCode: string;
}

export async function categorizeExpense(
  tenantId: TenantId,
  description: string,
  amount: number,
  vendor?: string
): Promise<CategorizationResult> {
  // Get historical categorizations for learning
  const historical = await db.query<{
    description: string;
    category: string;
    account_code: string;
  }>(
    `SELECT description, category, account_code
     FROM bank_transactions
     WHERE tenant_id = $1
       AND category IS NOT NULL
       AND description ILIKE $2
     LIMIT 5`,
    [tenantId, `%${description.substring(0, 20)}%`]
  );

  // Use ML + rules-based approach
  const results = await Promise.all([
    categorizeWithML(description, amount, vendor, historical.rows),
    categorizeWithRules(description, vendor),
    categorizeWithHistory(historical.rows),
  ]);

  // Weighted ensemble
  const weights = [0.5, 0.3, 0.2];
  const scores: Record<string, number> = {};

  results.forEach((result, index) => {
    if (result) {
      const key = result.category;
      if (!scores[key]) scores[key] = 0;
      scores[key] += result.confidence * weights[index];
    }
  });

  const bestCategory = Object.entries(scores).reduce((a, b) =>
    scores[a[0]] > scores[b[0]] ? a : b
  )[0] as ExpenseCategory | 'Other';

  const confidence = scores[bestCategory] || 0.5;

  // Get account code
  const accountCode = await getAccountCodeForCategory(tenantId, bestCategory);

  return {
    category: bestCategory,
    confidence: Math.min(confidence, 0.95),
    reasoning: `ML: ${results[0]?.category || 'N/A'}, Rules: ${results[1]?.category || 'N/A'}, History: ${results[2]?.category || 'N/A'}`,
    suggestedAccountCode: accountCode,
  };
}

async function categorizeWithML(
  description: string,
  amount: number,
  vendor: string | undefined,
  historical: Array<{ description: string; category: string }>
): Promise<CategorizationResult | null> {
  const prompt = `Categorize this business expense:
Description: ${description}
Amount: £${amount.toFixed(2)}
Vendor: ${vendor || 'Unknown'}

Historical patterns: ${historical.map(h => `${h.description} -> ${h.category}`).join(', ')}

UK expense categories: ${Object.keys(EXPENSE_CATEGORIES).join(', ')}

Return JSON: {"category": "category name", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at categorizing UK business expenses. Use standard UK accounting categories.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
    return {
      category: (result.category || 'Other') as ExpenseCategory | 'Other',
      confidence: Math.min(Math.max(result.confidence || 0.5, 0), 1),
      reasoning: result.reasoning || '',
      suggestedAccountCode: '5000',
    };
  } catch (error) {
    logger.error('ML categorization failed', error);
    return null;
  }
}

function categorizeWithRules(
  description: string,
  vendor: string | undefined
): CategorizationResult | null {
  const lowerDesc = description.toLowerCase();
  const lowerVendor = (vendor || '').toLowerCase();

  for (const [category, keywords] of Object.entries(EXPENSE_CATEGORIES)) {
    const allKeywords = [...keywords, category.toLowerCase()];
    if (allKeywords.some(keyword => lowerDesc.includes(keyword) || lowerVendor.includes(keyword))) {
      return {
        category: category as ExpenseCategory,
        confidence: 0.75,
        reasoning: `Matched keyword in description/vendor`,
        suggestedAccountCode: '5000',
      };
    }
  }

  return null;
}

function categorizeWithHistory(
  historical: Array<{ description: string; category: string }>
): CategorizationResult | null {
  if (historical.length === 0) return null;

  // Most common category
  const categoryCounts: Record<string, number> = {};
  historical.forEach(h => {
    categoryCounts[h.category] = (categoryCounts[h.category] || 0) + 1;
  });

  const bestCategory = Object.entries(categoryCounts).reduce((a, b) =>
    a[1] > b[1] ? a : b
  )[0];

  return {
    category: bestCategory as ExpenseCategory | 'Other',
    confidence: 0.7,
    reasoning: `Based on ${historical.length} similar historical transactions`,
    suggestedAccountCode: '5000',
  };
}

async function getAccountCodeForCategory(
  tenantId: TenantId,
  category: ExpenseCategory | 'Other'
): Promise<string> {
  // Map categories to account codes
  const categoryToAccount: Record<string, string> = {
    'Travel': '5100',
    'Meals': '5200',
    'Office': '5300',
    'Professional': '5400',
    'Marketing': '5500',
    'Utilities': '5600',
    'Rent': '5700',
    'Insurance': '5800',
    'Training': '5900',
    'Subscriptions': '6000',
    'Other': '5000',
  };

  return categoryToAccount[category] || '5000';
}
