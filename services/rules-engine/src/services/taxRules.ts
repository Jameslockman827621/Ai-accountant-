import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TaxRulepack, TaxRule } from '@ai-accountant/shared-types';
import OpenAI from 'openai';

const logger = createLogger('rules-engine-service');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// UK VAT Rules (simplified)
const UK_VAT_RULES: TaxRule[] = [
  {
    id: 'uk-vat-standard-rate',
    name: 'UK Standard VAT Rate',
    description: 'Apply 20% VAT to standard-rated goods and services',
    condition: "category === 'standard' && country === 'GB'",
    action: "taxRate = 0.20; taxAmount = amount * 0.20",
    priority: 1,
    isDeterministic: true,
  },
  {
    id: 'uk-vat-reduced-rate',
    name: 'UK Reduced VAT Rate',
    description: 'Apply 5% VAT to reduced-rate goods',
    condition: "category === 'reduced' && country === 'GB'",
    action: "taxRate = 0.05; taxAmount = amount * 0.05",
    priority: 2,
    isDeterministic: true,
  },
  {
    id: 'uk-vat-zero-rate',
    name: 'UK Zero VAT Rate',
    description: 'Apply 0% VAT to zero-rated goods',
    condition: "category === 'zero' && country === 'GB'",
    action: "taxRate = 0.00; taxAmount = 0",
    priority: 3,
    isDeterministic: true,
  },
  {
    id: 'uk-vat-exempt',
    name: 'UK VAT Exempt',
    description: 'No VAT on exempt supplies',
    condition: "category === 'exempt' && country === 'GB'",
    action: "taxRate = null; taxAmount = 0; isExempt = true",
    priority: 4,
    isDeterministic: true,
  },
];

export async function getTaxRulepack(country: string, version?: string): Promise<TaxRulepack | null> {
  let query = 'SELECT * FROM tax_rulepacks WHERE country = $1 AND is_active = true';
  const params: unknown[] = [country.toUpperCase()];

  if (version) {
    query += ' AND version = $2';
    params.push(version);
  } else {
    query += ' ORDER BY effective_from DESC LIMIT 1';
  }

  const result = await db.query<{
    id: string;
    country: string;
    version: string;
    rules: unknown;
    effective_from: Date;
    effective_to: Date | null;
    is_active: boolean;
  }>(query, params);

  if (result.rows.length === 0) {
    // Return default UK rules if none found
    if (country.toUpperCase() === 'GB') {
      return {
        id: 'default-uk',
        country: 'GB',
        version: '1.0.0',
        rules: UK_VAT_RULES,
        effectiveFrom: new Date('2024-01-01'),
        isActive: true,
      };
    }
    return null;
  }

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const rulepack: TaxRulepack = {
    id: row.id,
    country: row.country,
    version: row.version,
    rules: row.rules as TaxRule[],
    effectiveFrom: row.effective_from,
    isActive: row.is_active,
  };
  if (row.effective_to) {
    rulepack.effectiveTo = row.effective_to;
  }
  return rulepack;
}

export async function applyTaxRules(
  country: string,
  transaction: {
    amount: number;
    category?: string;
    description?: string;
    vendor?: string;
  }
): Promise<{
  taxRate: number | null;
  taxAmount: number;
  ruleId: string;
  reasoning?: string;
}> {
  const rulepack = await getTaxRulepack(country);

  if (!rulepack) {
    throw new Error(`No tax rulepack found for country: ${country}`);
  }

  // Try deterministic rules first
  for (const rule of rulepack.rules.sort((a, b) => a.priority - b.priority)) {
    if (rule.isDeterministic) {
      try {
        // Simple rule evaluation (in production, use a proper rule engine)
        const context = {
          amount: transaction.amount,
          category: transaction.category || 'standard',
          country: country.toUpperCase(),
          description: transaction.description || '',
          vendor: transaction.vendor || '',
        };

        // Evaluate condition (simplified - in production use a proper evaluator)
        if (evaluateCondition(rule.condition, context)) {
          const result = executeAction(rule.action, context);
          return {
            taxRate: result.taxRate,
            taxAmount: result.taxAmount,
            ruleId: rule.id,
          };
        }
      } catch (error) {
        logger.warn('Rule evaluation failed', { ruleId: rule.id, error });
        continue;
      }
    }
  }

  // If no deterministic rule matches, use LLM
  return await applyLLMTaxRules(country, transaction, rulepack);
}

async function applyLLMTaxRules(
  country: string,
  transaction: {
    amount: number;
    category?: string;
    description?: string;
    vendor?: string;
  },
  rulepack: TaxRulepack
): Promise<{
  taxRate: number | null;
  taxAmount: number;
  ruleId: string;
  reasoning: string;
}> {
  const prompt = `You are a tax expert. Determine the appropriate VAT rate for this transaction in ${country}.

Transaction details:
- Amount: ${transaction.amount}
- Category: ${transaction.category || 'unknown'}
- Description: ${transaction.description || 'N/A'}
- Vendor: ${transaction.vendor || 'N/A'}

Available tax rules:
${rulepack.rules.map((r) => `- ${r.name}: ${r.description}`).join('\n')}

Respond with JSON:
{
  "taxRate": <number between 0 and 1 or null for exempt>,
  "taxAmount": <calculated amount>,
  "ruleId": "<matching rule id>",
  "reasoning": "<explanation>"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a tax expert. Always respond with valid JSON only.',
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
    return {
      taxRate: result.taxRate,
      taxAmount: result.taxAmount,
      ruleId: result.ruleId,
      reasoning: result.reasoning,
    };
  } catch (error) {
    logger.error('LLM tax rule application failed', error instanceof Error ? error : new Error(String(error)));
    // Fallback to standard rate
    return {
      taxRate: 0.20,
      taxAmount: transaction.amount * 0.20,
      ruleId: 'uk-vat-standard-rate',
      reasoning: 'LLM evaluation failed, defaulted to standard rate',
    };
  }
}

function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  // Simplified condition evaluator - in production, use a proper rule engine
  try {
    // Replace variables with context values
    let evalCondition = condition;
    for (const [key, value] of Object.entries(context)) {
      const regex = new RegExp(`\\b${key}\\b`, 'g');
      if (typeof value === 'string') {
        evalCondition = evalCondition.replace(regex, `'${value}'`);
      } else {
        evalCondition = evalCondition.replace(regex, String(value));
      }
    }
    // Simple evaluation for common patterns
    if (evalCondition.includes('===')) {
      const parts = evalCondition.split('===').map(s => s.trim());
      const left = parts[0];
      const right = parts[1];
      if (!left || !right) {
        return false;
      }
      return String(context[left.replace(/'/g, '')] || left) === String(context[right.replace(/'/g, '')] || right);
    }
    if (evalCondition.includes('&&')) {
      return evalCondition.split('&&').every(part => evaluateCondition(part.trim(), context));
    }
    return false;
  } catch {
    return false;
  }
}

function executeAction(action: string, context: Record<string, unknown>): { taxRate: number | null; taxAmount: number } {
  // Simplified action executor - in production, use a proper rule engine
  const result: { taxRate: number | null; taxAmount: number } = { taxRate: null, taxAmount: 0 };

  try {
    // Parse action like "taxRate = 0.20; taxAmount = amount * 0.20"
    const statements = action.split(';').map(s => s.trim());
    for (const statement of statements) {
      if (statement.includes('taxRate =')) {
        const value = statement.split('=')[1]?.trim();
        if (value) {
          result.taxRate = parseFloat(value);
        }
      }
      if (statement.includes('taxAmount =')) {
        const expr = statement.split('=')[1]?.trim();
        if (expr && expr.includes('*')) {
          const parts = expr.split('*').map(s => s.trim());
          const left = parts[0];
          const right = parts[1];
          if (left && right) {
            const amount = parseFloat(String(context[left] || left));
            const rate = parseFloat(right);
            result.taxAmount = amount * rate;
          }
        }
      }
    }
    return result;
  } catch {
    const amount = (context.amount as number) || 0;
    return { taxRate: 0.20, taxAmount: amount * 0.20 };
  }
}
