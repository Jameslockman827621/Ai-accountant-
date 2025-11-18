import OpenAI from 'openai';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';

const logger = createLogger('classification-service');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL_VERSION = process.env.OPENAI_MODEL || 'gpt-4';

export interface ExpenseCategory {
  code: string;
  name: string;
  confidence: number;
  reasoning: string;
  subCategory?: string;
  taxDeductible: boolean;
  vatRecoverable: boolean;
}

/**
 * Advanced expense categorization with ML training from user corrections
 */
export async function categorizeExpenseAdvanced(
  tenantId: TenantId,
  description: string,
  amount: number,
  vendor?: string,
  date?: Date
): Promise<ExpenseCategory> {
  logger.info('Advanced expense categorization', { tenantId, description, amount });

  // Get historical categorizations for this tenant
  const historical = await db.query<{
    description: string;
    category: string;
    sub_category: string;
  }>(
    `SELECT description, category, sub_category
     FROM expense_categorizations
     WHERE tenant_id = $1
       AND description ILIKE '%' || $2 || '%'
     ORDER BY created_at DESC
     LIMIT 5`,
    [tenantId, description.substring(0, 20)]
  );

  // Build context from historical data
  const historicalContext =
    historical.rows.length > 0
      ? `\nHistorical categorizations for similar expenses:\n${historical.rows.map((h) => `- "${h.description}" → ${h.category}${h.sub_category ? ` / ${h.sub_category}` : ''}`).join('\n')}`
      : '';

  // Get tenant's chart of accounts for expense categories
  const chartOfAccounts = await db.query<{
    account_code: string;
    account_name: string;
  }>(
    `SELECT account_code, account_name
     FROM chart_of_accounts
     WHERE tenant_id = $1
       AND account_code LIKE '5%'
       AND is_active = true
     ORDER BY account_code
     LIMIT 20`,
    [tenantId]
  );

  const availableCategories = chartOfAccounts.rows
    .map((acc) => `${acc.account_code} - ${acc.account_name}`)
    .join(', ');

  const prompt = `Categorize this business expense with high accuracy.

Expense Details:
- Description: ${description}
- Amount: £${amount.toFixed(2)}
- Vendor: ${vendor || 'Unknown'}
- Date: ${date ? date.toLocaleDateString() : 'Unknown'}
${historicalContext}

Available Expense Categories:
${availableCategories || '5000 - General Expenses, 5100 - Office Expenses, 5200 - Travel, 5300 - Meals, 5400 - Professional Fees, 5500 - Marketing, 5600 - Utilities, 5700 - Rent, 5800 - Insurance, 5900 - Other'}

Return JSON:
{
  "code": "account code (e.g., 5100)",
  "name": "category name",
  "confidence": 0.0-1.0,
  "reasoning": "explanation",
  "subCategory": "optional sub-category",
  "taxDeductible": true/false,
  "vatRecoverable": true/false
}

Consider:
- UK tax rules for expense deductibility
- VAT recovery rules
- Industry-specific categorization
- Historical patterns for this tenant`;

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_VERSION,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert UK tax accountant. Categorize expenses accurately according to UK tax rules and HMRC guidelines. Always respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const response = JSON.parse(completion.choices[0]?.message?.content || '{}');

    // Validate and enhance categorization
    const category: ExpenseCategory = {
      code: response.code || '5900',
      name: response.name || 'Other Expenses',
      confidence: Math.min(1.0, Math.max(0.0, response.confidence || 0.7)),
      reasoning: response.reasoning || 'ML categorization',
      subCategory: response.subCategory,
      taxDeductible: response.taxDeductible !== false, // Default to true
      vatRecoverable: determineVATRecoverability(response.code, description, amount),
    };

    // Store categorization for learning
    await db.query(
      `INSERT INTO expense_categorizations (
        id, tenant_id, description, amount, vendor, category, sub_category, confidence, tax_deductible, vat_recoverable, created_at
      ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        tenantId,
        description,
        amount,
        vendor || null,
        category.code,
        category.subCategory || null,
        category.confidence,
        category.taxDeductible,
        category.vatRecoverable,
      ]
    );

    logger.info('Expense categorized', {
      tenantId,
      category: category.code,
      confidence: category.confidence,
    });
    return category;
  } catch (error) {
    logger.error(
      'Expense categorization failed',
      error instanceof Error ? error : new Error(String(error))
    );

    // Fallback categorization
    return {
      code: '5900',
      name: 'Other Expenses',
      confidence: 0.3,
      reasoning: 'Categorization failed, using default',
      taxDeductible: true,
      vatRecoverable: false,
    };
  }
}

function determineVATRecoverability(
  categoryCode: string,
  description: string,
  amount: number
): boolean {
  const lowerDesc = description.toLowerCase();
  const normalizedCode = categoryCode.trim();

  // VAT cannot be recovered on:
  // - Entertainment (except staff)
  // - Motor vehicles (unless 100% business use)
  // - Certain exempt supplies
  // - Personal expenses

  const nonRecoverableKeywords = [
    'entertainment',
    'client entertainment',
    'personal',
    'private',
    'motor vehicle',
    'car purchase',
  ];

  for (const keyword of nonRecoverableKeywords) {
    if (lowerDesc.includes(keyword)) {
      return false;
    }
  }

  // Staff entertainment is recoverable
  if (lowerDesc.includes('staff') && lowerDesc.includes('entertainment')) {
    return true;
  }

  // Certain categories (e.g., rent/insurance) can be partially recoverable; use simple heuristics
  if (normalizedCode.startsWith('57') && lowerDesc.includes('rent')) {
    return false;
  }

  // Zero or negative amounts generally shouldn't claim VAT
  if (amount <= 0) {
    return false;
  }

  // Most business expenses are VAT recoverable
  return true;
}

/**
 * Learn from user corrections to improve categorization
 */
export async function learnFromCategorizationCorrection(
  tenantId: TenantId,
  expenseId: string,
  correctCategory: string,
  originalCategory: string
): Promise<void> {
  logger.info('Learning from categorization correction', {
    tenantId,
    expenseId,
    correctCategory,
    originalCategory,
  });

  // Store correction
  await db.query(
    `INSERT INTO categorization_corrections (
      id, tenant_id, expense_id, original_category, correct_category, created_at
    ) VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
    [tenantId, expenseId, originalCategory, correctCategory]
  );

  // Update categorization accuracy metrics
  await db.query(
    `INSERT INTO categorization_metrics (
      tenant_id, category_code, correct_count, incorrect_count, updated_at
    ) VALUES ($1, $2, 0, 1, NOW())
    ON CONFLICT (tenant_id, category_code) DO UPDATE
    SET incorrect_count = categorization_metrics.incorrect_count + 1,
        updated_at = NOW()`,
    [tenantId, originalCategory]
  );

  // Update correct category metrics
  await db.query(
    `INSERT INTO categorization_metrics (
      tenant_id, category_code, correct_count, incorrect_count, updated_at
    ) VALUES ($1, $2, 1, 0, NOW())
    ON CONFLICT (tenant_id, category_code) DO UPDATE
    SET correct_count = categorization_metrics.correct_count + 1,
        updated_at = NOW()`,
    [tenantId, correctCategory]
  );
}
