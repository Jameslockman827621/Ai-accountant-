'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';
import ComplianceCalendar from './ComplianceCalendar';

const logger = createLogger('ReadinessDashboard');

interface ReadinessSummary {
  overall: number;
  dataCompleteness: number;
  reconciliationStatus: number;
  connectorHealth: number;
  taskCompletion: number;
  details: {
    missingData: string[];
    unmatchedTransactions: number;
    unhealthyConnectors: string[];
    pendingTasks: number;
  };
}

interface UpcomingDeadline {
  id: string;
  filingType?: string;
  dueDate: string;
  readinessScore: number;
  status: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface ReadinessDashboardProps {
  token: string;
  tenantId?: string;
}

export default function ReadinessDashboard({ token, tenantId }: ReadinessDashboardProps) {
  const [summary, setSummary] = useState<ReadinessSummary | null>(null);
  const [deadlines, setDeadlines] = useState<UpcomingDeadline[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 300000); // Refresh every 5 minutes
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      // Get upcoming deadlines
      const deadlinesRes = await fetch(`${API_BASE}/api/compliance/deadlines?days=30`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (deadlinesRes.ok) {
        const deadlinesData = await deadlinesRes.json();
        setDeadlines(deadlinesData.deadlines || []);

        // Calculate overall summary from deadlines
        if (deadlinesData.deadlines && deadlinesData.deadlines.length > 0) {
          const avgReadiness =
            deadlinesData.deadlines.reduce(
              (sum: number, d: UpcomingDeadline) => sum + (d.readinessScore || 0),
              0
            ) / deadlinesData.deadlines.length;

          setSummary({
            overall: Math.round(avgReadiness),
            dataCompleteness: 0, // Would be calculated from individual deadlines
            reconciliationStatus: 0,
            connectorHealth: 0,
            taskCompletion: 0,
            details: {
              missingData: [],
              unmatchedTransactions: 0,
              unhealthyConnectors: [],
              pendingTasks: 0,
            },
          });
        }
      }
    } catch (error) {
      logger.error('Failed to load readiness data', error);
    } finally {
      setLoading(false);
    }
  };

  const updateReadiness = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/compliance/readiness/update`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        await loadData();
        alert('Readiness scores updated');
      }
    } catch (error) {
      logger.error('Failed to update readiness', error);
      alert('Failed to update readiness scores');
    }
  };

  if (loading) {
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Readiness Dashboard</h1>
          <p className="text-gray-600 mt-1">Monitor your compliance readiness across all obligations</p>
        </div>
        <button
          onClick={updateReadiness}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Refresh Scores
        </button>
      </div>

      {/* Overall Readiness Score */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <ReadinessCard
            title="Overall Readiness"
            score={summary.overall}
            color="blue"
          />
          <ReadinessCard
            title="Data Completeness"
            score={summary.dataCompleteness}
            color="green"
          />
          <ReadinessCard
            title="Reconciliation"
            score={summary.reconciliationStatus}
            color="purple"
          />
          <ReadinessCard
            title="Connector Health"
            score={summary.connectorHealth}
            color="orange"
          />
        </div>
      )}

      {/* Upcoming Deadlines */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Upcoming Deadlines (Next 30 Days)</h2>
        {deadlines.length === 0 ? (
          <p className="text-gray-500">No upcoming deadlines</p>
        ) : (
          <div className="space-y-3">
            {deadlines.map(deadline => (
              <div
                key={deadline.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <h3 className="font-medium text-gray-900">
                      {deadline.filingType || 'Filing'}
                    </h3>
                    <StatusBadge status={deadline.status} />
                  </div>
                  <p className="text-sm text-gray-600">
                    Due: {new Date(deadline.dueDate).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center space-x-4">
                  <ReadinessBadge score={deadline.readinessScore} />
                  <button
                    onClick={() => {
                      window.location.href = `/compliance/calendar?obligationId=${deadline.id}`;
                    }}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Details */}
      {summary && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Readiness Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {summary.details.missingData.length > 0 && (
              <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                <h3 className="text-sm font-medium text-yellow-900 mb-2">Missing Data</h3>
                <ul className="list-disc list-inside text-sm text-yellow-800">
                  {summary.details.missingData.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {summary.details.unmatchedTransactions > 0 && (
              <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                <h3 className="text-sm font-medium text-orange-900 mb-2">
                  Unmatched Transactions
                </h3>
                <p className="text-sm text-orange-800">
                  {summary.details.unmatchedTransactions} transactions need reconciliation
                </p>
              </div>
            )}

            {summary.details.unhealthyConnectors.length > 0 && (
              <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                <h3 className="text-sm font-medium text-red-900 mb-2">Unhealthy Connectors</h3>
                <ul className="list-disc list-inside text-sm text-red-800">
                  {summary.details.unhealthyConnectors.map((connector, idx) => (
                    <li key={idx}>{connector}</li>
                  ))}
                </ul>
              </div>
            )}

            {summary.details.pendingTasks > 0 && (
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h3 className="text-sm font-medium text-blue-900 mb-2">Pending Tasks</h3>
                <p className="text-sm text-blue-800">
                  {summary.details.pendingTasks} tasks require attention
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReadinessCard({
  title,
  score,
  color,
}: {
  title: string;
  score: number;
  color: 'blue' | 'green' | 'purple' | 'orange';
}) {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-200',
    green: 'bg-green-50 border-green-200',
    purple: 'bg-purple-50 border-purple-200',
    orange: 'bg-orange-50 border-orange-200',
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <p className="text-sm font-medium opacity-80 mb-2">{title}</p>
      <div className="flex items-center space-x-3">
        <p className="text-3xl font-bold">{score}%</p>
        <div className="flex-1 bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full ${
              score >= 80 ? 'bg-green-600' : score >= 50 ? 'bg-yellow-600' : 'bg-red-600'
            }`}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function ReadinessBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-green-100 text-green-800' : score >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${color}`}>
      {score}% Ready
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    in_progress: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    missed: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
    </span>
  );
}
