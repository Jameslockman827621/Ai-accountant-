'use client';

import React, { useState, useEffect } from 'react';
import {
  ChartBarIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

interface QualityStats {
  averageAccuracy: number;
  averageCompleteness: number;
  averageComplianceRisk: number;
  averageComposite: number;
  documentCount: number;
}

interface FieldPerformance {
  fieldName: string;
  accuracy: number;
  completeness: number;
  averageConfidence: number;
  sampleCount: number;
}

interface ReviewerThroughput {
  reviewerId: string;
  reviewerName: string;
  documentsReviewed: number;
  averageReviewTime: number;
  accuracyRate: number;
}

interface TimeSeriesData {
  date: string;
  accuracy: number;
  completeness: number;
  complianceRisk: number;
  documentCount: number;
}

export default function QualityDashboard({ tenantId }: { tenantId: string }) {
  const [qualityStats, setQualityStats] = useState<QualityStats | null>(null);
  const [fieldPerformance, setFieldPerformance] = useState<FieldPerformance[]>([]);
  const [reviewerThroughput, setReviewerThroughput] = useState<ReviewerThroughput[]>([]);
  const [timeSeriesData, setTimeSeriesData] = useState<TimeSeriesData[]>([]);
  const [backlogStats, setBacklogStats] = useState<{
    total: number;
    byRiskLevel: Record<string, number>;
    avgTimeToFirstReview: number;
    slaBreaches: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [selectedDocumentType, setSelectedDocumentType] = useState<string>('all');

  useEffect(() => {
    loadDashboardData();
  }, [tenantId, dateRange, selectedDocumentType]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const params = new URLSearchParams({
        dateRange,
        documentType: selectedDocumentType,
      });

      // Load quality stats
      const statsResponse = await fetch(
        `/api/quality/stats?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (statsResponse.ok) {
        const stats = await statsResponse.json();
        setQualityStats(stats);
      }

      // Load field performance
      const fieldResponse = await fetch(
        `/api/quality/field-performance?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (fieldResponse.ok) {
        const fields = await fieldResponse.json();
        setFieldPerformance(fields);
      }

      // Load reviewer throughput
      const reviewerResponse = await fetch(
        `/api/quality/reviewer-throughput?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (reviewerResponse.ok) {
        const reviewers = await reviewerResponse.json();
        setReviewerThroughput(reviewers);
      }

      // Load time series
      const timeSeriesResponse = await fetch(
        `/api/quality/time-series?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (timeSeriesResponse.ok) {
        const timeSeries = await timeSeriesResponse.json();
        setTimeSeriesData(timeSeries);
      }

      // Load backlog stats
      const backlogResponse = await fetch(
        `/api/review-queue/backlog-stats`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (backlogResponse.ok) {
        const backlog = await backlogResponse.json();
        setBacklogStats(backlog);
      }
    } catch (error) {
      console.error('Failed to load dashboard data', error);
    } finally {
      setLoading(false);
    }
  };

  const getDateRangeDays = () => {
    switch (dateRange) {
      case '7d':
        return 7;
      case '30d':
        return 30;
      case '90d':
        return 90;
      default:
        return 365;
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  if (loading && !qualityStats) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Quality Dashboard</h2>
        <p className="text-gray-600">
          Monitor extraction accuracy, reviewer performance, and backlog metrics
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex items-center gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as typeof dateRange)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Document Type</label>
          <select
            value={selectedDocumentType}
            onChange={(e) => setSelectedDocumentType(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Types</option>
            <option value="invoice">Invoice</option>
            <option value="receipt">Receipt</option>
            <option value="statement">Statement</option>
            <option value="payslip">Payslip</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-500">Average Accuracy</h3>
            <ChartBarIcon className="h-5 w-5 text-blue-500" />
          </div>
          <div className="text-3xl font-bold text-gray-900">
            {qualityStats ? (qualityStats.averageAccuracy * 100).toFixed(1) : '0'}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Target: ≥98% for high-volume vendors
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-500">Completeness</h3>
            <CheckCircleIcon className="h-5 w-5 text-green-500" />
          </div>
          <div className="text-3xl font-bold text-gray-900">
            {qualityStats ? (qualityStats.averageCompleteness * 100).toFixed(1) : '0'}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Field-level recall ≥95%
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-500">Compliance Risk</h3>
            <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500" />
          </div>
          <div className="text-3xl font-bold text-gray-900">
            {qualityStats ? (qualityStats.averageComplianceRisk * 100).toFixed(1) : '0'}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Lower is better
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-500">Documents Processed</h3>
            <ClockIcon className="h-5 w-5 text-purple-500" />
          </div>
          <div className="text-3xl font-bold text-gray-900">
            {qualityStats?.documentCount.toLocaleString() || '0'}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Last {getDateRangeDays()} days
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Accuracy Over Time */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Extraction Accuracy Over Time</h3>
          <div className="h-64 flex items-center justify-center">
            {/* In production, would use a charting library like Chart.js or Recharts */}
            <div className="text-center text-gray-500">
              <ChartBarIcon className="h-12 w-12 mx-auto mb-2 text-gray-400" />
              <p>Chart visualization would appear here</p>
              <p className="text-xs mt-1">
                {timeSeriesData.length} data points
              </p>
            </div>
          </div>
        </div>

        {/* Per-Field Performance */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Per-Field Performance</h3>
          <div className="space-y-3">
            {fieldPerformance.slice(0, 5).map((field) => (
              <div key={field.fieldName} className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">
                      {field.fieldName}
                    </span>
                    <span className="text-xs text-gray-500">
                      {(field.accuracy * 100).toFixed(1)}% accuracy
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ width: `${field.accuracy * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Reviewer Throughput & Backlog */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Reviewer Throughput */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Reviewer Throughput</h3>
          <div className="space-y-4">
            {reviewerThroughput.map((reviewer) => (
              <div key={reviewer.reviewerId} className="border-b border-gray-200 pb-4 last:border-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">{reviewer.reviewerName}</span>
                  <span className="text-sm text-gray-500">
                    {reviewer.documentsReviewed} documents
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Avg. Time:</span>{' '}
                    <span className="font-medium">
                      {formatDuration(reviewer.averageReviewTime)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Accuracy:</span>{' '}
                    <span className="font-medium">
                      {(reviewer.accuracyRate * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Backlog Stats */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Review Backlog</h3>
          {backlogStats && (
            <div className="space-y-4">
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <div className="text-3xl font-bold text-gray-900 mb-1">
                  {backlogStats.total}
                </div>
                <div className="text-sm text-gray-500">Pending Reviews</div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">Critical</span>
                  <span className="font-medium text-red-600">
                    {backlogStats.byRiskLevel.critical || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">High</span>
                  <span className="font-medium text-orange-600">
                    {backlogStats.byRiskLevel.high || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">Medium</span>
                  <span className="font-medium text-yellow-600">
                    {backlogStats.byRiskLevel.medium || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">Low</span>
                  <span className="font-medium text-gray-600">
                    {backlogStats.byRiskLevel.low || 0}
                  </span>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">Avg. Time to First Review</span>
                  <span className="font-medium">
                    {formatDuration(backlogStats.avgTimeToFirstReview)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">SLA Breaches</span>
                  <span className={`font-medium ${backlogStats.slaBreaches > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {backlogStats.slaBreaches}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  Target: 90% of high-risk docs reviewed within 4 hours
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Export Button */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={() => {
            // Export to CSV
            const csv = generateCSV();
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `quality-dashboard-${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
          }}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Export to CSV
        </button>
      </div>
    </div>
  );

  function generateCSV(): string {
    const headers = ['Date', 'Accuracy', 'Completeness', 'Compliance Risk', 'Document Count'];
    const rows = timeSeriesData.map((d) => [
      d.date,
      (d.accuracy * 100).toFixed(2),
      (d.completeness * 100).toFixed(2),
      (d.complianceRisk * 100).toFixed(2),
      d.documentCount.toString(),
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }
}
