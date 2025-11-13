import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import OpenAI from 'openai';

const logger = createLogger('analytics-service');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface PredictiveForecast {
  metric: 'revenue' | 'expenses' | 'profit' | 'cashflow' | 'tax';
  period: { start: Date; end: Date };
  forecast: Array<{ date: Date; value: number; confidence: number }>;
  trend: 'increasing' | 'decreasing' | 'stable';
  factors: string[];
  confidence: number;
}

/**
 * Generate predictive forecast using ML
 */
export async function generatePredictiveForecast(
  tenantId: TenantId,
  metric: PredictiveForecast['metric'],
  months: number = 12
): Promise<PredictiveForecast> {
  logger.info('Generating predictive forecast', { tenantId, metric, months });

  // Get historical data
  const historical = await getHistoricalData(tenantId, metric, 24); // 24 months history

  // Use GPT-4 for time series forecasting
  const prompt = `Generate a ${months}-month forecast for ${metric} based on this historical data:

${historical.map(h => `${h.date.toISOString().split('T')[0]}: £${h.value.toFixed(2)}`).join('\n')}

Return JSON:
{
  "forecast": [{"date": "YYYY-MM-DD", "value": number, "confidence": 0.0-1.0}],
  "trend": "increasing|decreasing|stable",
  "factors": ["factor1", "factor2"],
  "overallConfidence": 0.0-1.0
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are an expert financial forecaster. Provide accurate predictions based on historical trends.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || '{}');

    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + months);

    return {
      metric,
      period: {
        start: new Date(),
        end: endDate,
      },
      forecast: (result.forecast || []).map((f: { date: string; value: number; confidence: number }) => ({
        date: new Date(f.date),
        value: f.value || 0,
        confidence: f.confidence || 0.5,
      })),
      trend: (result.trend || 'stable') as PredictiveForecast['trend'],
      factors: result.factors || [],
      confidence: result.overallConfidence || 0.5,
    };
  } catch (error) {
    logger.error('Predictive forecast failed', error);
    throw error;
  }
}

async function getHistoricalData(
  tenantId: TenantId,
  metric: PredictiveForecast['metric'],
  months: number
): Promise<Array<{ date: Date; value: number }>> {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);

  let query = '';
  const params: unknown[] = [tenantId, startDate];

  switch (metric) {
    case 'revenue':
      query = `
        SELECT DATE_TRUNC('month', transaction_date) as date, SUM(amount) as value
        FROM ledger_entries
        WHERE tenant_id = $1
          AND transaction_date >= $2
          AND entry_type = 'credit'
          AND account_code LIKE '4%'
        GROUP BY DATE_TRUNC('month', transaction_date)
        ORDER BY date
      `;
      break;
    case 'expenses':
      query = `
        SELECT DATE_TRUNC('month', transaction_date) as date, SUM(amount) as value
        FROM ledger_entries
        WHERE tenant_id = $1
          AND transaction_date >= $2
          AND entry_type = 'debit'
          AND (account_code LIKE '5%' OR account_code LIKE '6%')
        GROUP BY DATE_TRUNC('month', transaction_date)
        ORDER BY date
      `;
      break;
    case 'profit':
      query = `
        SELECT DATE_TRUNC('month', transaction_date) as date,
               SUM(CASE WHEN entry_type = 'credit' AND account_code LIKE '4%' THEN amount ELSE 0 END) -
               SUM(CASE WHEN entry_type = 'debit' AND (account_code LIKE '5%' OR account_code LIKE '6%') THEN amount ELSE 0 END) as value
        FROM ledger_entries
        WHERE tenant_id = $1 AND transaction_date >= $2
        GROUP BY DATE_TRUNC('month', transaction_date)
        ORDER BY date
      `;
      break;
    default:
      query = `
        SELECT DATE_TRUNC('month', transaction_date) as date, SUM(amount) as value
        FROM ledger_entries
        WHERE tenant_id = $1 AND transaction_date >= $2
        GROUP BY DATE_TRUNC('month', transaction_date)
        ORDER BY date
      `;
  }

  const result = await db.query<{
    date: Date;
    value: number;
  }>(query, params);

  return result.rows.map(row => ({
    date: row.date,
    value: typeof row.value === 'number' ? row.value : parseFloat(String(row.value || '0')),
  }));
}
