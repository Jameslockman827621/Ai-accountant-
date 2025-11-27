import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import OpenAI from 'openai';
import { EnhancedForecaster } from '../enhancedForecasting';

const logger = createLogger('analytics-service');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface CashflowForecastOptions {
  horizonMonths?: number;
  sensitivity?: 'conservative' | 'balanced' | 'aggressive';
}

export interface CashflowForecastResult {
  baseline: number;
  projectedRunwayMonths: number;
  forecast: Array<{
    period: string;
    forecast: number;
    confidence: number;
    lowerBound: number;
    upperBound: number;
  }>;
  signals: Array<{
    type: 'burn' | 'inflow' | 'risk';
    label: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  insights: string;
}

export interface AnomalyFinding {
  type: 'variance' | 'duplicate' | 'suspicious_vendor' | 'missing_match' | 'velocity_change';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  evidence: Record<string, unknown>;
  suggestedAction: string;
}

async function getCashMovements(tenantId: TenantId): Promise<Array<{ period: string; net: number }>> {
  const result = await db.query<{ period: string; net: string | number }>(
    `SELECT DATE_TRUNC('month', transaction_date) as period,
            SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END) as net
       FROM ledger_entries
      WHERE tenant_id = $1
      GROUP BY DATE_TRUNC('month', transaction_date)
      ORDER BY period ASC`,
    [tenantId]
  );

  return result.rows.map(row => ({
    period: row.period,
    net: typeof row.net === 'number' ? row.net : parseFloat(String(row.net || '0')),
  }));
}

async function getBankMovements(tenantId: TenantId): Promise<Array<{ period: string; net: number }>> {
  const result = await db.query<{ period: string; inflow: string | number; outflow: string | number }>(
    `SELECT DATE_TRUNC('month', COALESCE(posted_at, date)) as period,
            SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as inflow,
            SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) as outflow
       FROM bank_transactions
      WHERE tenant_id = $1
      GROUP BY DATE_TRUNC('month', COALESCE(posted_at, date))
      ORDER BY period ASC`,
    [tenantId]
  );

  return result.rows.map(row => ({
    period: row.period,
    net:
      (typeof row.inflow === 'number' ? row.inflow : parseFloat(String(row.inflow || '0')))
      + (typeof row.outflow === 'number' ? row.outflow : parseFloat(String(row.outflow || '0'))),
  }));
}

function blendSeries(
  ledger: Array<{ period: string; net: number }>,
  bank: Array<{ period: string; net: number }>
): Array<{ period: string; net: number }> {
  const map = new Map<string, { ledger?: number; bank?: number }>();

  ledger.forEach(item => {
    map.set(item.period, { ...(map.get(item.period) || {}), ledger: item.net });
  });
  bank.forEach(item => {
    map.set(item.period, { ...(map.get(item.period) || {}), bank: item.net });
  });

  return Array.from(map.entries())
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .map(([period, values]) => ({
      period,
      net: ((values.ledger ?? 0) + (values.bank ?? 0)) / (values.bank && values.ledger ? 2 : 1),
    }));
}

async function summarizeWithLLM(
  blendedSeries: Array<{ period: string; net: number }>,
  forecast: CashflowForecastResult['forecast']
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return 'LLM insights unavailable: missing OPENAI_API_KEY.';
  }

  const prompt = `You are a CFO-focused copilot. Using the blended ledger+bank cash movement series and the forecast,
  summarize cash runway, key risks, and tactical actions in under 120 words.

Historical (period -> net cash):
${blendedSeries.map(item => `${item.period}: ${item.net.toFixed(2)}`).join('\n')}

Forecast (period -> forecast, bounds):
${forecast
    .map(
      item =>
        `${item.period}: ${item.forecast.toFixed(2)} (±${((item.upperBound - item.lowerBound) / 2).toFixed(2)})`
    )
    .join('\n')}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content:
          'You are a concise CFO advisor. Emphasize cash runway, variance drivers, risk flags, and tactical levers.',
      },
      { role: 'user', content: prompt },
    ],
  });

  return completion.choices[0]?.message?.content || 'Unable to generate insights.';
}

function detectCashAnomalies(
  blendedSeries: Array<{ period: string; net: number }>,
  sensitivity: NonNullable<CashflowForecastOptions['sensitivity']>
): AnomalyFinding[] {
  if (blendedSeries.length < 3) return [];

  const anomalies: AnomalyFinding[] = [];
  const window = sensitivity === 'aggressive' ? 2 : 3;
  const threshold = sensitivity === 'conservative' ? 2.5 : sensitivity === 'balanced' ? 2 : 1.5;

  blendedSeries.forEach((point, index) => {
    if (index < window) return;
    const slice = blendedSeries.slice(index - window, index);
    const mean = slice.reduce((acc, item) => acc + item.net, 0) / slice.length;
    const variance =
      slice.reduce((acc, item) => acc + Math.pow(item.net - mean, 2), 0) / Math.max(slice.length - 1, 1);
    const stdDev = Math.sqrt(variance);

    if (stdDev > 0 && Math.abs(point.net - mean) > threshold * stdDev) {
      anomalies.push({
        type: 'variance',
        description: `Net cash of ${point.net.toFixed(2)} deviates from average ${mean.toFixed(2)}.`,
        severity: Math.abs(point.net - mean) > threshold * stdDev * 1.5 ? 'high' : 'medium',
        score: Math.min(1, Math.abs(point.net - mean) / (stdDev * threshold)),
        evidence: { period: point.period, mean, stdDev },
        suggestedAction: 'Review inflows/outflows for exceptional items and reconcile with bank feeds.',
      });
    }
  });

  return anomalies;
}

function detectBankLedgerGaps(
  ledgerSeries: Array<{ period: string; net: number }>,
  bankSeries: Array<{ period: string; net: number }>
): AnomalyFinding[] {
  const anomalies: AnomalyFinding[] = [];
  const index = new Map(ledgerSeries.map(item => [item.period, item.net]));

  bankSeries.forEach(item => {
    const ledgerNet = index.get(item.period);
    if (ledgerNet === undefined) {
      anomalies.push({
        type: 'missing_match',
        description: `Bank activity for ${item.period} missing in ledger entries`,
        severity: 'high',
        score: 0.82,
        evidence: { period: item.period, bankNet: item.net },
        suggestedAction: 'Run auto-categorization and reconciliation to post missing ledger entries.',
      });
    } else {
      const variance = Math.abs(item.net - ledgerNet);
      const tolerance = Math.max(100, Math.abs(ledgerNet) * 0.08);
      if (variance > tolerance) {
        anomalies.push({
          type: 'variance',
          description: `Ledger-bank variance of ${variance.toFixed(2)} in ${item.period}`,
          severity: variance > tolerance * 2 ? 'critical' : 'medium',
          score: Math.min(1, variance / (tolerance * 2)),
          evidence: { ledgerNet, bankNet: item.net, tolerance },
          suggestedAction: 'Re-run bank match and flag suspicious payments for review.',
        });
      }
    }
  });

  return anomalies;
}

export async function runCashflowPipeline(
  tenantId: TenantId,
  options: CashflowForecastOptions = {}
): Promise<{ forecast: CashflowForecastResult; anomalies: AnomalyFinding[] }> {
  logger.info('Running cashflow pipeline', { tenantId, options });

  const horizonMonths = options.horizonMonths || 6;
  const sensitivity = options.sensitivity || 'balanced';
  const forecaster = new EnhancedForecaster();

  const ledgerSeries = await getCashMovements(tenantId);
  const bankSeries = await getBankMovements(tenantId);
  const blended = blendSeries(ledgerSeries, bankSeries);

  const forecast = await forecaster.generateForecast({
    tenantId,
    metric: 'cash_flow',
    periods: horizonMonths,
    method: 'seasonal',
    historicalPeriods: Math.max(ledgerSeries.length, bankSeries.length, 6),
  });

  const anomalies = [
    ...detectCashAnomalies(blended, sensitivity),
    ...detectBankLedgerGaps(ledgerSeries, bankSeries),
  ];

  const lastNet = blended.length > 1 ? blended[blended.length - 1]?.net : 0;
  const burnRate = typeof lastNet === 'number' ? lastNet : 0;
  const firstForecast = forecast.periods[0];
  const runwayMonths = burnRate < 0 && firstForecast
    ? Math.max(1, Math.round(Math.abs(firstForecast.forecast / burnRate)))
    : forecast.periods.length;

  const signals: CashflowForecastResult['signals'] = [];
  if (burnRate < 0) {
    signals.push({ type: 'burn', label: `Monthly burn ${burnRate.toFixed(2)}`, severity: 'medium' });
  }
  if (anomalies.some(a => a.severity === 'high' || a.severity === 'critical')) {
    signals.push({ type: 'risk', label: 'Cashflow anomalies detected', severity: 'high' });
  }
  if (forecast.trend === 'increasing') {
    signals.push({ type: 'inflow', label: 'Positive inflow trend', severity: 'low' });
  }

  const llmInsights = await summarizeWithLLM(blended, forecast.periods);

  return {
    forecast: {
      baseline: blended[blended.length - 1]?.net || 0,
      projectedRunwayMonths: runwayMonths,
      forecast: forecast.periods,
      signals,
      insights: llmInsights,
    },
    anomalies,
  };
}

