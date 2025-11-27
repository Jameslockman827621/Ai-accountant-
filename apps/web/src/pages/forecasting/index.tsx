import React, { useEffect, useMemo, useState } from 'react';
import ScenarioPlanner from '../../components/ScenarioPlanner';

interface ForecastCard {
  title: string;
  metric: string;
  confidence: string;
  signal: string;
}

interface SensitivityPoint {
  label: string;
  value: number;
}

interface PortfolioResponse {
  portfolio: {
    cashFlow: { businessSignals: string[] };
    runway: { businessSignals: string[] };
    taxAccruals: { businessSignals: string[] };
  };
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

export default function ForecastingPage() {
  const [token, setToken] = useState('');
  const [cards, setCards] = useState<ForecastCard[]>([]);
  const [sensitivity, setSensitivity] = useState<SensitivityPoint[]>([]);

  useEffect(() => {
    const authToken = localStorage.getItem('authToken') || '';
    setToken(authToken);
  }, []);

  useEffect(() => {
    if (!token) return;

    const loadPortfolio = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/analytics/forecasting/models`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Unable to load forecasting models');
        const data = (await response.json()) as PortfolioResponse;
        const snapshots: ForecastCard[] = [
          {
            title: 'Cash flow model',
            metric: 'Liquidity cadence',
            confidence: data.portfolio.cashFlow.businessSignals[0] ?? 'Awaiting signal',
            signal: data.portfolio.cashFlow.businessSignals[1] ?? '',
          },
          {
            title: 'Runway model',
            metric: 'Months of coverage',
            confidence: data.portfolio.runway.businessSignals[0] ?? 'Awaiting signal',
            signal: data.portfolio.runway.businessSignals[1] ?? '',
          },
          {
            title: 'Tax accrual model',
            metric: 'Quarterly accruals',
            confidence: data.portfolio.taxAccruals.businessSignals[0] ?? 'Awaiting signal',
            signal: data.portfolio.taxAccruals.businessSignals[1] ?? '',
          },
        ];
        setCards(snapshots);
        setSensitivity(buildSensitivity(data));
      } catch (error) {
        console.error(error);
      }
    };

    void loadPortfolio();
  }, [token]);

  const chartWidth = useMemo(() => Math.max(1, sensitivity.length) * 48, [sensitivity.length]);
  const maxValue = Math.max(...sensitivity.map(point => point.value), 1);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="rounded-2xl bg-white p-6 shadow">
          <h1 className="text-2xl font-semibold text-gray-900">Forecasting cockpit</h1>
          <p className="mt-2 text-sm text-gray-600">
            Blend cash flow, runway, and tax accrual models with interactive what-if planning. Keep re-training on schedule and
            pipe anomalies directly into the alerts center.
          </p>
        </header>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {cards.map(card => (
            <article key={card.title} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">{card.metric}</p>
                  <h3 className="text-base font-semibold text-gray-900">{card.title}</h3>
                </div>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">Model</span>
              </div>
              <p className="mt-3 text-sm text-gray-700">{card.confidence}</p>
              <p className="mt-2 text-xs text-gray-500">{card.signal}</p>
            </article>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">What-if parameters</h2>
                <p className="text-sm text-gray-600">Tweak assumptions to see runway and accruals sensitivity.</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Live</span>
            </div>
            <ScenarioPlanner token={token} />
          </div>

          <div className="rounded-2xl bg-white p-6 shadow">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Sensitivity chart</h2>
                <p className="text-sm text-gray-600">How growth, spend, and tax obligations move the forecast bands.</p>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">Auto-updating</span>
            </div>
            <div className="mt-4 overflow-x-auto">
              <svg width={chartWidth} height={220} className="min-w-full">
                {sensitivity.map((point, index) => {
                  const height = (point.value / maxValue) * 180;
                  const x = index * 48 + 20;
                  const y = 200 - height;
                  return (
                    <g key={point.label}>
                      <rect
                        x={x}
                        y={y}
                        width={32}
                        height={height}
                        rx={6}
                        className="fill-indigo-500/70"
                      />
                      <text x={x + 16} y={y - 6} textAnchor="middle" className="fill-gray-700 text-xs">
                        {point.value.toFixed(1)}
                      </text>
                      <text x={x + 16} y={214} textAnchor="middle" className="fill-gray-500 text-[10px]">
                        {point.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function buildSensitivity(data: PortfolioResponse): SensitivityPoint[] {
  return [
    { label: 'Cash', value: parseFloat(data.portfolio.cashFlow.businessSignals.length.toString()) + 1 },
    { label: 'Runway', value: parseFloat(data.portfolio.runway.businessSignals.length.toString()) + 1.5 },
    { label: 'Tax', value: parseFloat(data.portfolio.taxAccruals.businessSignals.length.toString()) + 2 },
  ];
}
