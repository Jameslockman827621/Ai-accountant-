import OpenAI from 'openai';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('bank-feed-service');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface TransactionCategory {
  category: string;
  subcategory?: string;
  accountCode: string;
  confidence: number;
  reasoning: string;
}

const CATEGORY_MAPPINGS: Record<string, string> = {
  'office supplies': '6001',
  'travel': '6002',
  'meals': '6003',
  'utilities': '6004',
  'rent': '6005',
  'software': '6006',
  'marketing': '6007',
  'professional services': '6008',
  'insurance': '6009',
  'bank fees': '6010',
  'income': '4001',
  'sales': '4001',
  'refund': '4002',
};

export async function categorizeTransaction(
  tenantId: TenantId,
  transactionId: string,
  amount: number,
  description: string,
  merchantName?: string,
  category?: string[]
): Promise<TransactionCategory> {
  logger.info('Categorizing transaction', { tenantId, transactionId });

  // First, try keyword matching (fast path)
  const keywordMatch = matchByKeywords(description, merchantName, category);
  if (keywordMatch && keywordMatch.confidence > 0.8) {
    return keywordMatch;
  }

  // Use LLM for more accurate categorization
  try {
    const prompt = `Categorize this bank transaction for accounting purposes.

Transaction details:
- Amount: £${amount.toFixed(2)}
- Description: ${description}
- Merchant: ${merchantName || 'N/A'}
- Plaid Category: ${category?.join(', ') || 'N/A'}

Respond with JSON:
{
  "category": "<main category>",
  "subcategory": "<optional subcategory>",
  "accountCode": "<chart of accounts code>",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation>"
}

Common categories: Office Supplies, Travel, Meals, Utilities, Rent, Software, Marketing, Professional Services, Insurance, Bank Fees, Income, Sales, Refund`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are an expert accountant. Categorize transactions accurately for UK accounting standards.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from LLM');
    }

    const result = JSON.parse(response) as TransactionCategory;

    // Validate and enhance with account code if not provided
    if (!result.accountCode && result.category) {
      result.accountCode = CATEGORY_MAPPINGS[result.category.toLowerCase()] || '6999'; // Other expenses
    }

    // Get chart of accounts to validate
    const chartResult = await db.query<{ accounts: unknown }>(
      'SELECT accounts FROM chart_of_accounts WHERE tenant_id = $1',
      [tenantId]
    );

    const chartRow = chartResult.rows[0];
    if (chartRow && chartRow.accounts) {
      const accounts = chartRow.accounts as Array<{ code: string; name: string }> | undefined;
      if (accounts && Array.isArray(accounts)) {
        const accountExists = accounts.some(acc => acc.code === result.accountCode);
        if (!accountExists) {
          // Use default account
          result.accountCode = '6999';
          result.confidence = Math.max(0.5, result.confidence - 0.2);
        }
      }
    }

    logger.info('Transaction categorized', {
      transactionId,
      category: result.category,
      accountCode: result.accountCode,
      confidence: result.confidence,
    });

    return result;
  } catch (error) {
    logger.error('LLM categorization failed', error instanceof Error ? error : new Error(String(error)));
    
    // Fallback to keyword matching
    return keywordMatch || {
      category: 'Uncategorized',
      accountCode: '6999',
      confidence: 0.5,
      reasoning: 'Failed to categorize automatically',
    };
  }
}

function matchByKeywords(
  description: string,
  merchantName?: string,
  plaidCategory?: string[]
): TransactionCategory | null {
  const text = `${description} ${merchantName || ''} ${plaidCategory?.join(' ') || ''}`.toLowerCase();

  // Office supplies
  if (text.match(/\b(office|stationery|paper|pens|supplies)\b/)) {
    return {
      category: 'Office Supplies',
      accountCode: '6001',
      confidence: 0.85,
      reasoning: 'Matched office supplies keywords',
    };
  }

  // Travel
  if (text.match(/\b(travel|train|flight|hotel|uber|taxi|parking)\b/)) {
    return {
      category: 'Travel',
      accountCode: '6002',
      confidence: 0.85,
      reasoning: 'Matched travel keywords',
    };
  }

  // Meals
  if (text.match(/\b(restaurant|cafe|coffee|food|meal|lunch|dinner)\b/)) {
    return {
      category: 'Meals',
      accountCode: '6003',
      confidence: 0.85,
      reasoning: 'Matched meals keywords',
    };
  }

  // Utilities
  if (text.match(/\b(electric|gas|water|utility|broadband|internet|phone)\b/)) {
    return {
      category: 'Utilities',
      accountCode: '6004',
      confidence: 0.85,
      reasoning: 'Matched utilities keywords',
    };
  }

  // Rent
  if (text.match(/\b(rent|lease|landlord)\b/)) {
    return {
      category: 'Rent',
      accountCode: '6005',
      confidence: 0.9,
      reasoning: 'Matched rent keywords',
    };
  }

  // Software
  if (text.match(/\b(software|saas|subscription|app|cloud|aws|azure)\b/)) {
    return {
      category: 'Software',
      accountCode: '6006',
      confidence: 0.85,
      reasoning: 'Matched software keywords',
    };
  }

  // Marketing
  if (text.match(/\b(advertising|marketing|google ads|facebook|social media)\b/)) {
    return {
      category: 'Marketing',
      accountCode: '6007',
      confidence: 0.85,
      reasoning: 'Matched marketing keywords',
    };
  }

  // Income
  if (text.match(/\b(payment|invoice|sale|revenue|income|deposit)\b/) && !text.match(/\b(refund|return)\b/)) {
    return {
      category: 'Income',
      accountCode: '4001',
      confidence: 0.8,
      reasoning: 'Matched income keywords',
    };
  }

  return null;
}

export async function autoCategorizeTransactions(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date
): Promise<{ categorized: number; failed: number }> {
  logger.info('Auto-categorizing transactions', { tenantId, startDate, endDate });

    // Get uncategorized transactions
  const transactions = await db.query<{
    id: string;
    amount: number;
    description: string;
    category: string | null;
  }>(
    `SELECT id, amount, description, category
     FROM bank_transactions
     WHERE tenant_id = $1
       AND date >= $2
       AND date <= $3
       AND (category IS NULL OR category = '{}'::jsonb)
     ORDER BY date DESC
     LIMIT 100`,
    [tenantId, startDate, endDate]
  );

  let categorized = 0;
  let failed = 0;

  for (const transaction of transactions.rows) {
    if (!transaction) {
      continue;
    }
    try {
      const categoryResult = await categorizeTransaction(
        tenantId,
        transaction.id,
        transaction.amount,
        transaction.description,
        undefined,
        transaction.category ? JSON.parse(transaction.category) as string[] : undefined
      );

      // Update transaction with category
      await db.query(
        `UPDATE bank_transactions
         SET category = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [
          JSON.stringify({
            category: categoryResult.category,
            subcategory: categoryResult.subcategory,
            accountCode: categoryResult.accountCode,
            confidence: categoryResult.confidence,
            reasoning: categoryResult.reasoning,
          }),
          transaction.id,
        ]
      );

      categorized++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to categorize transaction', {
        transactionId: transaction.id,
        error: errorMessage,
      });
      failed++;
    }
  }

  logger.info('Auto-categorization completed', { categorized, failed, tenantId });

  return { categorized, failed };
}
