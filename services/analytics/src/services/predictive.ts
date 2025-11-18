import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import OpenAI from 'openai';

const logger = createLogger('analytics-service');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const sanitizeNumber = (value: unknown, fallback = 0): number =>
  isFiniteNumber(value) ? value : fallback;

const sanitizeConfidence = (value: unknown, fallback = 0.5): number =>
  clamp01(isFiniteNumber(value) ? value : fallback);

const sanitizeFactors = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

export interface Prediction {
  type: 'revenue' | 'expense' | 'cashflow' | 'tax';
  period: { start: Date; end: Date };
  predictedValue: number;
  confidence: number;
  factors: string[];
}

export async function predictRevenue(
  tenantId: TenantId,
  months: number = 6
): Promise<Prediction> {
  logger.info('Predicting revenue', { tenantId, months });

  // Get historical revenue data
  const historical = await db.query<{
    month: Date;
    revenue: number;
  }>(
    `SELECT 
       DATE_TRUNC('month', transaction_date) as month,
       SUM(amount) as revenue
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'credit'
       AND account_code LIKE '4%'
       AND transaction_date >= NOW() - INTERVAL '12 months'
     GROUP BY DATE_TRUNC('month', transaction_date)
     ORDER BY month`,
    [tenantId]
  );

  const data = historical.rows.map(row => ({
    month: row.month.toISOString(),
    revenue: typeof row.revenue === 'number' ? row.revenue : parseFloat(String(row.revenue || '0')),
  }));

  // Use LLM for prediction
  const prompt = `Based on this historical revenue data, predict revenue for the next ${months} months:

${data.map(d => `- ${d.month}: £${d.revenue.toFixed(2)}`).join('\n')}

Provide prediction in JSON:
{
  "predictedValue": <total predicted revenue>,
  "confidence": <0.0-1.0>,
  "factors": ["<factor1>", "<factor2>"]
}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: 'You are a financial analyst. Provide accurate revenue predictions based on historical data.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.5,
    response_format: { type: 'json_object' },
  });

  const response = JSON.parse(
    completion.choices[0]?.message?.content || '{}'
  ) as Record<string, unknown>;

  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + months);

  return {
    type: 'revenue',
    period: {
      start: new Date(),
      end: endDate,
    },
    predictedValue: sanitizeNumber(response.predictedValue),
    confidence: sanitizeConfidence(response.confidence),
    factors: sanitizeFactors(response.factors),
  };
}

export async function detectTrends(tenantId: TenantId): Promise<Array<{
  metric: string;
  trend: 'increasing' | 'decreasing' | 'stable';
  change: number;
  significance: 'high' | 'medium' | 'low';
}>> {
  logger.info('Detecting trends', { tenantId });

  // Analyze revenue trends
  const revenueTrend = await db.query<{
    current: number;
    previous: number;
  }>(
    `SELECT 
       SUM(CASE WHEN transaction_date >= DATE_TRUNC('month', NOW()) THEN amount ELSE 0 END) as current,
       SUM(CASE WHEN transaction_date >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
                AND transaction_date < DATE_TRUNC('month', NOW()) THEN amount ELSE 0 END) as previous
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'credit'
       AND account_code LIKE '4%'`,
    [tenantId]
  );

  const current = typeof revenueTrend.rows[0]?.current === 'number'
    ? revenueTrend.rows[0].current
    : parseFloat(String(revenueTrend.rows[0]?.current || '0'));
  const previous = typeof revenueTrend.rows[0]?.previous === 'number'
    ? revenueTrend.rows[0].previous
    : parseFloat(String(revenueTrend.rows[0]?.previous || '0'));

  const change = previous > 0 ? ((current - previous) / previous) * 100 : 0;

  return [
    {
      metric: 'Revenue',
      trend: change > 5 ? 'increasing' : change < -5 ? 'decreasing' : 'stable',
      change,
      significance: Math.abs(change) > 10 ? 'high' : Math.abs(change) > 5 ? 'medium' : 'low',
    },
  ];
}
