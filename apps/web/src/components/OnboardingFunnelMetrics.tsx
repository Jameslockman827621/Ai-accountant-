'use client';

import { useState, useEffect } from 'react';

interface FunnelMetricsProps {
  token: string;
  tenantId?: string;
  timeframe?: '7d' | '30d' | '90d' | 'all';
}

interface FunnelData {
  step: string;
  views: number;
  completions: number;
  abandonments: number;
  avgTimeSpent: number;
  completionRate: number;
}

interface OverallMetrics {
  totalSessions: number;
  completionRate: number;
  avgTimeToComplete: number;
  connectorAuthorizationRate: number;
  kycApprovalRate: number;
}

export default function OnboardingFunnelMetrics({
  token: _token,
  tenantId: _tenantId,
  timeframe = '30d',
}: FunnelMetricsProps) {
  const [funnelData, setFunnelData] = useState<FunnelData[]>([]);
  const [overallMetrics, setOverallMetrics] = useState<OverallMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
  }, [timeframe, tenantId]);

  const loadMetrics = async () => {
    setIsLoading(true);
    try {
      // In production, this would call a dedicated metrics API
      // For now, simulate data
      const simulatedData = generateSimulatedMetrics();
      setFunnelData(simulatedData.funnel);
      setOverallMetrics(simulatedData.overall);
    } catch (error) {
      console.error('Failed to load metrics', error);
    } finally {
      setIsLoading(false);
    }
  };

  const generateSimulatedMetrics = () => {
    const steps = [
      'welcome',
      'business_profile',
      'tax_scope',
      'chart_of_accounts',
      'bank_connection',
      'filing_preferences',
      'first_document',
      'complete',
    ];

    const funnel: FunnelData[] = steps.map((step, index) => {
      const baseViews = 1000 - index * 50;
      const completions = Math.floor(baseViews * (0.95 - index * 0.05));
      const abandonments = baseViews - completions;
      const completionRate = (completions / baseViews) * 100;

      return {
        step: step.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        views: baseViews,
        completions,
        abandonments,
        avgTimeSpent: Math.floor(Math.random() * 300 + 60), // 60-360 seconds
        completionRate,
      };
    });

    const overall: OverallMetrics = {
      totalSessions: 1000,
      completionRate: 87.5,
      avgTimeToComplete: 8.5, // minutes
      connectorAuthorizationRate: 82.3,
      kycApprovalRate: 94.2,
    };

    return { funnel, overall };
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overall Metrics */}
      {overallMetrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard
            title="Total Sessions"
            value={overallMetrics.totalSessions.toLocaleString()}
            trend="+12%"
            trendUp={true}
          />
          <MetricCard
            title="Completion Rate"
            value={`${overallMetrics.completionRate.toFixed(1)}%`}
            trend="+2.3%"
            trendUp={true}
            target={90}
          />
          <MetricCard
            title="Avg. Time"
            value={`${overallMetrics.avgTimeToComplete.toFixed(1)} min`}
            trend="-0.5 min"
            trendUp={true}
            target={10}
          />
          <MetricCard
            title="Connector Auth"
            value={`${overallMetrics.connectorAuthorizationRate.toFixed(1)}%`}
            trend="+5.1%"
            trendUp={true}
            target={80}
          />
          <MetricCard
            title="KYC Approval"
            value={`${overallMetrics.kycApprovalRate.toFixed(1)}%`}
            trend="+1.2%"
            trendUp={true}
            target={95}
          />
        </div>
      )}

      {/* Funnel Visualization */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Onboarding Funnel</h3>
          <select
            value={timeframe}
            onChange={(e) => {
              // Would trigger reload with new timeframe
            }}
            className="text-sm border border-gray-300 rounded px-3 py-1"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </div>

        <div className="space-y-4">
          {funnelData.map((step) => (
            <FunnelStep
              key={step.step}
              data={step}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  trend,
  trendUp,
  target,
}: {
  title: string;
  value: string;
  trend: string;
  trendUp: boolean;
  target?: number;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-600 mb-1">{title}</p>
      <p className="text-2xl font-bold text-gray-900 mb-1">{value}</p>
      <div className="flex items-center space-x-2">
        <span className={`text-sm ${trendUp ? 'text-green-600' : 'text-red-600'}`}>
          {trendUp ? '↑' : '↓'} {trend}
        </span>
        {target && (
          <span className="text-xs text-gray-500">
            Target: {target}%
          </span>
        )}
      </div>
    </div>
  );
}

function FunnelStep({ data }: { data: FunnelData }) {
  const widthPercentage = (data.completions / data.views) * 100;
  const dropoffPercentage = ((data.abandonments / data.views) * 100).toFixed(1);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center space-x-2">
          <span className="font-medium text-gray-900">{data.step}</span>
          <span className="text-gray-500">
            ({data.completions} / {data.views})
          </span>
        </div>
        <div className="flex items-center space-x-4 text-xs text-gray-600">
          <span>{data.completionRate.toFixed(1)}% complete</span>
          <span>⏱️ {Math.floor(data.avgTimeSpent / 60)}m {data.avgTimeSpent % 60}s</span>
          {data.abandonments > 0 && (
            <span className="text-red-600">{dropoffPercentage}% dropoff</span>
          )}
        </div>
      </div>
      <div className="relative w-full h-8 bg-gray-100 rounded-lg overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full bg-blue-600 transition-all duration-500"
          style={{ width: `${widthPercentage}%` }}
        ></div>
        <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-700">
          {data.completionRate.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}
