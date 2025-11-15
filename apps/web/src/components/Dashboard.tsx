'use client';

import React, { useState, useEffect } from 'react';
import DocumentReviewPanel from './DocumentReviewPanel';
import ProcessingStatus from './ProcessingStatus';
import HMRCConnectionCard from './HMRCConnectionCard';
import HMRCReceiptsPanel from './HMRCReceiptsPanel';
import OnboardingWizard from './OnboardingWizard';
import OnboardingProgressCard from './OnboardingProgressCard';
import ReconciliationDashboard from './ReconciliationDashboard';
import SupportCenterPanel from './SupportCenterPanel';
import { useOnboarding } from '@/hooks/useOnboarding';

interface DashboardStats {
  period: {
    start: string;
    end: string;
  };
  revenue: number;
  expenses: number;
  profit: number;
  vat: {
    net: number;
    output: number;
    input: number;
  };
  upcomingDeadlines: Array<{
    type: string;
    description: string;
    dueDate: string;
    amount: number;
    daysUntilDue: number;
    status: string;
  }>;
}

interface DashboardProps {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  token: string;
  onLogout: () => void;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

export default function Dashboard({ user, token, onLogout }: DashboardProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  const {
    progress: onboardingProgress,
    isLoading: onboardingLoading,
    isSubmitting: onboardingSubmitting,
    error: onboardingError,
    completeStep,
    recordEvent,
    getStepData,
  } = useOnboarding(token);

  useEffect(() => {
    if (!onboardingProgress) {
      return;
    }
    if (onboardingProgress.currentStep !== 'complete' && !isOnboardingOpen) {
      setIsOnboardingOpen(true);
      recordEvent('wizard_opened', onboardingProgress.currentStep, {
        progress: onboardingProgress.progress,
      });
    }
  }, [onboardingProgress, isOnboardingOpen, recordEvent]);

  useEffect(() => {
    if (!token) {
      setError('Missing authentication token');
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    async function fetchStats() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(
          `${API_BASE}/api/analytics/dashboard`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Dashboard request failed: ${response.status}`);
        }

        const data = await response.json() as { stats: DashboardStats };
        setStats(data.stats);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to fetch dashboard stats', err);
        setError('Unable to load dashboard data right now.');
      } finally {
        setLoading(false);
      }
    }

    fetchStats();

    return () => controller.abort();
  }, [token]);

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading dashboard…</div>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen space-y-4">
        <p className="text-red-600">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!stats) {
    return <div className="flex items-center justify-center h-screen">No dashboard data available.</div>;
  }

  const shouldShowOnboardingCard = Boolean(onboardingProgress && onboardingProgress.progress < 100);

    return (
      <div className="min-h-screen bg-gray-50 p-8">
          <div className="max-w-7xl mx-auto space-y-8">
          {onboardingProgress && isOnboardingOpen && (
            <OnboardingWizard
              token={token}
              progress={onboardingProgress}
              onStepComplete={completeStep}
              onClose={() => {
                setIsOnboardingOpen(false);
                recordEvent('wizard_closed', onboardingProgress.currentStep, {
                  progress: onboardingProgress.progress,
                });
              }}
              trackEvent={recordEvent}
              isSubmitting={onboardingSubmitting}
              getStepData={getStepData}
            />
          )}
          <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm text-gray-500">Welcome back</p>
              <h1 className="text-3xl font-bold text-gray-900">{user.name}</h1>
              <p className="text-sm text-gray-500">
                {new Date(stats.period.start).toLocaleDateString('en-GB')} –{' '}
                {new Date(stats.period.end).toLocaleDateString('en-GB')}
              </p>
            </div>
            <button
              onClick={onLogout}
              className="self-start px-4 py-2 border border-gray-300 rounded hover:bg-gray-100"
            >
              Sign out
            </button>
          </header>

            {shouldShowOnboardingCard && onboardingProgress && (
              <OnboardingProgressCard
                progress={onboardingProgress}
                onResume={() => {
                  setIsOnboardingOpen(true);
                  recordEvent('wizard_opened', onboardingProgress.currentStep, {
                    progress: onboardingProgress.progress,
                    resume: true,
                  });
                }}
                isLoading={onboardingLoading}
                error={onboardingError}
              />
            )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard title="Revenue" value={stats.revenue} trend="up" color="green" />
            <StatCard title="Expenses" value={stats.expenses} trend="down" color="red" />
            <StatCard
              title="Net Profit"
              value={stats.profit}
              trend={stats.profit >= 0 ? 'up' : 'down'}
              color={stats.profit >= 0 ? 'green' : 'red'}
            />
            <StatCard title="VAT Due" value={stats.vat.net} trend="neutral" color="blue">
              <p className="text-xs text-gray-500">
                Output £{stats.vat.output.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-gray-500">
                Input £{stats.vat.input.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
              </p>
            </StatCard>
          </div>

          <ProcessingStatus token={token} />
            <ReconciliationDashboard token={token} />

          <section className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold">Upcoming Deadlines</h2>
                <p className="text-sm text-gray-500">Next 120 days</p>
              </div>
            </div>
            {stats.upcomingDeadlines.length > 0 ? (
              <div className="divide-y">
                {stats.upcomingDeadlines.map(deadline => (
                  <div key={`${deadline.type}-${deadline.dueDate}`} className="py-4 flex items-center justify-between">
                    <div>
                      <p className="font-semibold capitalize">{deadline.description}</p>
                      <p className="text-sm text-gray-500">
                        Due {new Date(deadline.dueDate).toLocaleDateString('en-GB')} · {deadline.daysUntilDue} days
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">£{deadline.amount.toFixed(2)}</p>
                      <span className="text-xs uppercase tracking-wide text-gray-500">{deadline.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No filing deadlines in the upcoming window.</p>
            )}
          </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <DocumentReviewPanel token={token} />
              <HMRCConnectionCard token={token} />
            </div>
            <HMRCReceiptsPanel token={token} />
            <SupportCenterPanel token={token} />
        </div>
      </div>
    );
}

function StatCard({
  title,
  value,
  trend,
  color,
  children,
}: {
  title: string;
  value: number;
  trend: 'up' | 'down' | 'neutral';
  color: 'green' | 'red' | 'blue';
  children?: React.ReactNode;
}) {
  const colorClasses = {
    green: 'bg-green-50 border-green-200',
    red: 'bg-red-50 border-red-200',
    blue: 'bg-blue-50 border-blue-200',
  };

  return (
    <div className={`bg-white rounded-lg shadow p-6 border-l-4 ${colorClasses[color]}`}>
      <h3 className="text-sm font-medium text-gray-600 mb-2">{title}</h3>
      <p className="text-2xl font-bold">
        £{value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
      {children}
    </div>
  );
}
