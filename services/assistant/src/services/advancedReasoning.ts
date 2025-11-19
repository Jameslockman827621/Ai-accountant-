import { db } from '@ai-accountant/database';
import { createServiceLogger } from '@ai-accountant/observability';
import { TenantId } from '@ai-accountant/shared-types';
import { runChatCompletion } from '../clients/openaiClient';

const logger = createServiceLogger('assistant-service');

export interface FinancialCalculation {
  type: 'vat' | 'tax' | 'profit' | 'cashflow' | 'forecast';
  result: number;
  breakdown: Array<{ label: string; value: number }>;
  explanation: string;
}

export interface ForecastResult {
  period: { start: Date; end: Date };
  forecast: Array<{ date: Date; amount: number; type: 'revenue' | 'expense' | 'net' }>;
  confidence: number;
  assumptions: string[];
}

export async function performFinancialCalculation(
  tenantId: TenantId,
  question: string
): Promise<FinancialCalculation | null> {
  logger.info('Performing financial calculation', { tenantId, question });

  // Get recent financial data
  const ledgerEntries = await db.query<{
    entry_type: string;
    amount: number;
    tax_amount: number | null;
    transaction_date: Date;
    account_code: string;
  }>(
    `SELECT entry_type, amount, tax_amount, transaction_date, account_code
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= NOW() - INTERVAL '12 months'
     ORDER BY transaction_date DESC
     LIMIT 1000`,
    [tenantId]
  );

  // Build context for LLM
  const context = {
    revenue: ledgerEntries.rows
      .filter(e => e.entry_type === 'credit' && e.account_code.startsWith('4'))
      .reduce((sum, e) => sum + e.amount, 0),
    expenses: ledgerEntries.rows
      .filter(e => e.entry_type === 'debit' && (e.account_code.startsWith('5') || e.account_code.startsWith('6')))
      .reduce((sum, e) => sum + e.amount, 0),
    vat: ledgerEntries.rows
      .filter(e => e.tax_amount)
      .reduce((sum, e) => sum + (e.tax_amount || 0), 0),
    entryCount: ledgerEntries.rows.length,
  };

  const prompt = `You are an expert accountant. Answer this financial question with calculations:

Question: ${question}

Financial Context:
- Revenue (last 12 months): £${context.revenue.toFixed(2)}
- Expenses (last 12 months): £${context.expenses.toFixed(2)}
- Total VAT: £${context.vat.toFixed(2)}
- Transaction count: ${context.entryCount}

If the question requires a calculation, provide:
1. The calculation type (vat, tax, profit, cashflow, or forecast)
2. The result as a number
3. A breakdown showing how you calculated it
4. An explanation

Respond in JSON format:
{
  "type": "<calculation type>",
  "result": <number>,
  "breakdown": [{"label": "<description>", "value": <number>}],
  "explanation": "<detailed explanation>"
}

If no calculation is needed, return null.`;

  try {
      const completion = await runChatCompletion({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are an expert accountant. Provide accurate financial calculations and explanations. Always respond with valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      return null;
    }

    const result = JSON.parse(response) as FinancialCalculation | { result: null };
    
    if ('result' in result && result.result === null) {
      return null;
    }

    return result as FinancialCalculation;
  } catch (error) {
    logger.error('Financial calculation failed', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

export async function generateCashFlowForecast(
  tenantId: TenantId,
  months: number = 6
): Promise<ForecastResult> {
  logger.info('Generating cash flow forecast', { tenantId, months });

  // Get historical cash flow data
  const historicalData = await db.query<{
    date: Date;
    amount: number;
    entry_type: string;
  }>(
    `SELECT DATE_TRUNC('month', transaction_date) as date,
            SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END) as amount,
            entry_type
     FROM ledger_entries
     WHERE tenant_id = $1
       AND account_code LIKE '11%'
       AND transaction_date >= NOW() - INTERVAL '12 months'
     GROUP BY DATE_TRUNC('month', transaction_date), entry_type
     ORDER BY date`,
    [tenantId]
  );

  const monthlyData = historicalData.rows.map(row => ({
    date: row.date,
    amount: typeof row.amount === 'number' ? row.amount : parseFloat(String(row.amount || '0')),
  }));

  // Use LLM to generate forecast based on historical data
  const prompt = `Generate a cash flow forecast for the next ${months} months based on this historical data:

Historical Monthly Cash Flow:
${monthlyData.map(d => `- ${d.date.toISOString().split('T')[0]}: £${d.amount.toFixed(2)}`).join('\n')}

Provide a forecast in JSON format:
{
  "forecast": [
    {"date": "<YYYY-MM-DD>", "amount": <number>, "type": "revenue|expense|net"}
  ],
  "confidence": <0.0-1.0>,
  "assumptions": ["<assumption 1>", "<assumption 2>"]
}`;

  try {
      const completion = await runChatCompletion({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a financial analyst. Generate realistic cash flow forecasts based on historical data.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.5,
      response_format: { type: 'json_object' },
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No forecast generated');
    }

    const forecastData = JSON.parse(response) as {
      forecast: Array<{ date: string; amount: number; type: string }>;
      confidence: number;
      assumptions: string[];
    };

    const startDate = new Date();
    const forecast = forecastData.forecast.map((item, index) => {
      const date = new Date(startDate);
      date.setMonth(date.getMonth() + index + 1);
      return {
        date,
        amount: item.amount,
        type: item.type as 'revenue' | 'expense' | 'net',
      };
    });

    return {
      period: {
        start: startDate,
        end: new Date(startDate.getFullYear(), startDate.getMonth() + months, 1),
      },
      forecast,
      confidence: forecastData.confidence,
      assumptions: forecastData.assumptions,
    };
  } catch (error) {
    logger.error('Cash flow forecast failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function detectAnomalies(
  tenantId: TenantId,
  days: number = 30
): Promise<Array<{
  type: 'unusual_amount' | 'unusual_frequency' | 'unusual_category' | 'duplicate';
  transactionId: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  reason: string;
}>> {
  logger.info('Detecting anomalies', { tenantId, days });

  // Get recent transactions
  const transactions = await db.query<{
    id: string;
    amount: number;
    description: string;
    date: Date;
    category: string | null;
  }>(
    `SELECT id, amount, description, date, category
     FROM bank_transactions
     WHERE tenant_id = $1
       AND date >= NOW() - INTERVAL '${days} days'
     ORDER BY date DESC`,
    [tenantId]
  );

  const anomalies: Array<{
    type: 'unusual_amount' | 'unusual_frequency' | 'unusual_category' | 'duplicate';
    transactionId: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
    reason: string;
  }> = [];

  // Calculate statistics
  const amounts = transactions.rows.map(t => Math.abs(t.amount));
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance = amounts.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / amounts.length;
  const stdDev = Math.sqrt(variance);

  // Detect unusual amounts (more than 3 standard deviations from mean)
  for (const transaction of transactions.rows) {
    const amount = Math.abs(transaction.amount);
    
    if (amount > mean + 3 * stdDev) {
      anomalies.push({
        type: 'unusual_amount',
        transactionId: transaction.id,
        description: transaction.description,
        severity: amount > mean + 5 * stdDev ? 'high' : 'medium',
        reason: `Amount (£${amount.toFixed(2)}) is significantly higher than average (£${mean.toFixed(2)})`,
      });
    }

    // Detect duplicates (same amount and description on same day)
    const duplicates = transactions.rows.filter(
      t => t.id !== transaction.id &&
      Math.abs(t.amount) === amount &&
      t.description === transaction.description &&
      t.date.toDateString() === transaction.date.toDateString()
    );

    if (duplicates.length > 0) {
      anomalies.push({
        type: 'duplicate',
        transactionId: transaction.id,
        description: transaction.description,
        severity: 'medium',
        reason: `Possible duplicate transaction (${duplicates.length + 1} similar transactions found)`,
      });
    }
  }

  logger.info('Anomaly detection completed', {
    tenantId,
    transactionCount: transactions.rows.length,
    anomalyCount: anomalies.length,
  });

  return anomalies;
}
