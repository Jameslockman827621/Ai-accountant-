'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface ScenarioPlannerProps {
  token: string;
}

interface ScenarioResult {
  baseline: {
    monthlyRevenue: number;
    monthlyExpenses: number;
    monthlyBurn: number;
    cashOnHand: number;
    runwayMonths: number;
  };
  scenario: {
    monthlyRevenue: number;
    monthlyExpenses: number;
    monthlyBurn: number;
    cashStart: number;
    cashProjection: Array<{ month: number; cash: number }>;
    runwayMonths: number;
    warnings: string[];
    insights: string[];
  };
  dividendComparison?: {
    salaryNet: number;
    dividendNet: number;
    estimatedSavings: number;
    recommendation: string;
  };
}

interface ScenarioFormState {
  horizonMonths: number;
  revenueDeltaPct: number;
  expenseDeltaPct: number;
  cashInjection: number;
  hiringPlan: number;
  avgHireCost: number;
  dividendPayout: number;
  salaryPerMonth: number;
  dividendPerMonth: number;
}

const defaultForm: ScenarioFormState = {
  horizonMonths: 12,
  revenueDeltaPct: 5,
  expenseDeltaPct: 0,
  cashInjection: 0,
  hiringPlan: 0,
  avgHireCost: 4500,
  dividendPayout: 0,
  salaryPerMonth: 4000,
  dividendPerMonth: 3000,
};

export default function ScenarioPlanner({ token }: ScenarioPlannerProps) {
  const [form, setForm] = useState<ScenarioFormState>(defaultForm);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headers = useMemo<HeadersInit>(
    () => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }),
    [token]
  );

  const runScenario = useCallback(
    async (state: ScenarioFormState) => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`${API_BASE}/api/analytics/scenarios`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            horizonMonths: state.horizonMonths,
            adjustments: {
              revenueDeltaPct: state.revenueDeltaPct,
              expenseDeltaPct: state.expenseDeltaPct,
              cashInjection: state.cashInjection,
              hiringPlan: state.hiringPlan,
              avgHireCost: state.avgHireCost,
              dividendPayout: state.dividendPayout,
            },
            dividendPlan: {
              salaryPerMonth: state.salaryPerMonth,
              dividendPerMonth: state.dividendPerMonth,
            },
          }),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body || 'Failed to run scenario analysis');
        }
        const data = (await response.json()) as { scenario: ScenarioResult };
        setResult(data.scenario);
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Unable to run scenario');
      } finally {
        setLoading(false);
      }
    },
    [headers]
  );

  useEffect(() => {
    void runScenario(defaultForm);
  }, [runScenario]);

  const handleChange = (field: keyof ScenarioFormState, value: number) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void runScenario(form);
  };

  return (
    <section className="rounded-2xl bg-white p-6 shadow space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Scenario Planner</h3>
          <p className="text-sm text-gray-500">
            Forecast cash runway and compare compensation strategies with lightweight adjustments.
          </p>
        </div>
        <button
          onClick={() => setForm(defaultForm)}
          className="text-sm text-gray-500 underline decoration-dotted"
        >
          Reset defaults
        </button>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <NumberInput
          label="Horizon (months)"
          value={form.horizonMonths}
          min={3}
          max={36}
          onChange={value => handleChange('horizonMonths', value)}
        />
        <NumberInput
          label="Revenue change %"
          value={form.revenueDeltaPct}
          min={-50}
          max={200}
          onChange={value => handleChange('revenueDeltaPct', value)}
        />
        <NumberInput
          label="Expense change %"
          value={form.expenseDeltaPct}
          min={-50}
          max={100}
          onChange={value => handleChange('expenseDeltaPct', value)}
        />
        <NumberInput
          label="Cash injection (£)"
          value={form.cashInjection}
          min={0}
          step={1000}
          onChange={value => handleChange('cashInjection', value)}
        />
        <NumberInput
          label="New hires (count)"
          value={form.hiringPlan}
          min={0}
          max={50}
          onChange={value => handleChange('hiringPlan', value)}
        />
        <NumberInput
          label="Avg cost per hire (£/mo)"
          value={form.avgHireCost}
          min={2000}
          step={250}
          onChange={value => handleChange('avgHireCost', value)}
        />
        <NumberInput
          label="Dividend payout (month 1)"
          value={form.dividendPayout}
          min={0}
          step={500}
          onChange={value => handleChange('dividendPayout', value)}
        />
        <NumberInput
          label="Salary draw (£/mo)"
          value={form.salaryPerMonth}
          min={0}
          step={250}
          onChange={value => handleChange('salaryPerMonth', value)}
        />
        <NumberInput
          label="Dividend draw (£/mo)"
          value={form.dividendPerMonth}
          min={0}
          step={250}
          onChange={value => handleChange('dividendPerMonth', value)}
        />
        <div className="md:col-span-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? 'Running…' : 'Run scenario'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </form>

      {result && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ScenarioCard title="Baseline" metrics={result.baseline} />
            <ScenarioCard
              title="Scenario"
              metrics={{
                monthlyRevenue: result.scenario.monthlyRevenue,
                monthlyExpenses: result.scenario.monthlyExpenses,
                monthlyBurn: result.scenario.monthlyBurn,
                cashOnHand: result.scenario.cashProjection[0]?.cash ?? result.scenario.cashStart,
                runwayMonths: result.scenario.runwayMonths,
              }}
            />
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-700">Cash projection</h4>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-gray-600 md:grid-cols-4">
              {result.scenario.cashProjection.slice(0, 12).map(point => (
                <div key={point.month} className="rounded border border-gray-100 p-3">
                  <p className="text-xs uppercase text-gray-500">Month {point.month}</p>
                  <p className={`font-semibold ${point.cash < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    £{point.cash.toLocaleString('en-GB', { minimumFractionDigits: 0 })}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {(result.scenario.insights.length > 0 || result.scenario.warnings.length > 0) && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {result.scenario.insights.length > 0 && (
                <InsightList title="Insights" items={result.scenario.insights} tone="positive" />
              )}
              {result.scenario.warnings.length > 0 && (
                <InsightList title="Risks" items={result.scenario.warnings} tone="warning" />
              )}
            </div>
          )}

          {result.dividendComparison && (
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Salary vs Dividend</p>
              <p className="mt-1">
                Salary net: £{result.dividendComparison.salaryNet.toLocaleString('en-GB', { minimumFractionDigits: 0 })} ·
                Dividend net: £{result.dividendComparison.dividendNet.toLocaleString('en-GB', { minimumFractionDigits: 0 })}
              </p>
              <p className="mt-1">
                Estimated monthly savings: £{result.dividendComparison.estimatedSavings.toLocaleString('en-GB', { minimumFractionDigits: 0 })}
              </p>
              <p className="mt-1">{result.dividendComparison.recommendation}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-sm text-gray-700">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={event => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
      />
    </label>
  );
}

function ScenarioCard({
  title,
  metrics,
}: {
  title: string;
  metrics: ScenarioResult['baseline'];
}) {
  const rows: Array<{ label: string; value: number | string; emphasize?: boolean }> = [
    { label: 'Monthly revenue', value: `£${metrics.monthlyRevenue.toLocaleString('en-GB')}` },
    { label: 'Monthly expenses', value: `£${metrics.monthlyExpenses.toLocaleString('en-GB')}` },
    { label: 'Monthly burn', value: `£${metrics.monthlyBurn.toLocaleString('en-GB')}`, emphasize: metrics.monthlyBurn > 0 },
    { label: 'Cash on hand', value: `£${metrics.cashOnHand.toLocaleString('en-GB')}` },
    {
      label: 'Runway',
      value: Number.isFinite(metrics.runwayMonths)
        ? `${metrics.runwayMonths.toFixed(1)} months`
        : '∞',
    },
  ];

  return (
    <div className="rounded-lg border border-gray-100 p-4">
      <h4 className="text-sm font-semibold text-gray-700">{title}</h4>
      <dl className="mt-3 space-y-2 text-sm text-gray-600">
        {rows.map(row => (
          <div key={row.label} className="flex items-center justify-between">
            <dt>{row.label}</dt>
            <dd className={row.emphasize ? 'font-semibold text-red-600' : 'font-semibold text-gray-900'}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function InsightList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'positive' | 'warning';
}) {
  const styles =
    tone === 'positive'
      ? 'border-green-200 bg-green-50 text-green-800'
      : 'border-red-200 bg-red-50 text-red-800';
  return (
    <div className={`rounded-lg border p-4 text-sm ${styles}`}>
      <p className="font-semibold">{title}</p>
      <ul className="mt-2 space-y-1 list-disc pl-4">
        {items.map(insight => (
          <li key={insight}>{insight}</li>
        ))}
      </ul>
    </div>
  );
}
