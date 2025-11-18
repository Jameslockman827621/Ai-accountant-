'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('IngestionDashboard');

interface IngestionStats {
  totalIngested: number;
  totalProcessed: number;
  totalFailed: number;
  bySourceType: Record<string, {
    ingested: number;
    processed: number;
    failed: number;
  }>;
  averageProcessingTime: number;
  successRate: number;
}

interface IngestionLogItem {
  id: string;
  sourceType: string;
  connectorProvider?: string;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  ingestedAt: string;
  processedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  classificationConfidence?: number;
  reconciliationStatus?: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface IngestionDashboardProps {
  token: string;
  tenantId: string;
}

interface EmailAlias {
  id: string;
  aliasEmail: string;
  enabled: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

export default function IngestionDashboard({ token, tenantId }: IngestionDashboardProps) {
  const [stats, setStats] = useState<IngestionStats | null>(null);
  const [log, setLog] = useState<IngestionLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'processing' | 'completed' | 'failed'>('all');
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month'>('week');
  const [aliases, setAliases] = useState<EmailAlias[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'channels' | 'rules'>('overview');

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [dateRange]);

  const loadData = async () => {
    try {
      const endDate = new Date();
      const startDate = new Date();
      
      if (dateRange === 'today') {
        startDate.setHours(0, 0, 0, 0);
      } else if (dateRange === 'week') {
        startDate.setDate(startDate.getDate() - 7);
      } else {
        startDate.setMonth(startDate.getMonth() - 1);
      }

      // Load stats
      const statsRes = await fetch(
        `${API_BASE}/api/ingestion/stats?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.stats);
      }

      // Load log
      const status = filter === 'all' ? undefined : filter;
      const logParams = new URLSearchParams();
      if (status) logParams.append('status', status);
      logParams.append('limit', '100');

      const logRes = await fetch(
        `${API_BASE}/api/ingestion/log?${logParams.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (logRes.ok) {
        const logData = await logRes.json();
        setLog(logData.log || []);
      }

      // Load email aliases
      const aliasesRes = await fetch(`${API_BASE}/api/ingestion/email/aliases`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (aliasesRes.ok) {
        const aliasesData = await aliasesRes.json();
        setAliases(aliasesData.aliases || []);
      }
    } catch (error) {
      logger.error('Failed to load ingestion data', error);
    } finally {
      setLoading(false);
    }
  };

  const createEmailAlias = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ingestion/email/aliases`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresInDays: 365 }),
      });
      if (res.ok) {
        const data = await res.json();
        setAliases([...aliases, data.alias]);
      }
    } catch (error) {
      logger.error('Failed to create email alias', error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
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
          <h1 className="text-3xl font-bold text-gray-900">Ingestion Dashboard</h1>
          <p className="text-gray-600 mt-1">Monitor data ingestion and processing status</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {(['overview', 'channels', 'rules'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* Channels Tab (Chunk 1) */}
      {activeTab === 'channels' && (
        <div className="space-y-6">
          {/* Email Channel */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Email Forwarding</h2>
              <button
                onClick={createEmailAlias}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Create Email Alias
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Forward documents to these email addresses to automatically ingest them.
            </p>
            {aliases.length === 0 ? (
              <p className="text-gray-500 text-sm">No email aliases created yet.</p>
            ) : (
              <div className="space-y-3">
                {aliases.map(alias => (
                  <div key={alias.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{alias.aliasEmail}</p>
                      <p className="text-sm text-gray-600">
                        {alias.lastUsedAt
                          ? `Last used: ${new Date(alias.lastUsedAt).toLocaleDateString()}`
                          : 'Never used'}
                        {alias.expiresAt && ` • Expires: ${new Date(alias.expiresAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    <button
                      onClick={() => copyToClipboard(alias.aliasEmail)}
                      className="ml-4 px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                    >
                      Copy
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Webhook Channel */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Webhook Endpoints</h2>
            <p className="text-sm text-gray-600 mb-4">
              Configure webhooks to receive documents from external systems.
            </p>
            <div className="space-y-3">
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="font-medium text-gray-900 mb-1">Generic Webhook</p>
                <code className="text-sm text-gray-600">
                  {API_BASE}/api/ingestion/webhooks/:source
                </code>
                <button
                  onClick={() => copyToClipboard(`${API_BASE}/api/ingestion/webhooks/:source`)}
                  className="ml-2 px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>

          {/* CSV Dropzone */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">CSV Dropzone</h2>
            <p className="text-sm text-gray-600 mb-4">
              Upload CSV files directly for processing.
            </p>
            <CSVDropzone token={token} />
          </div>
        </div>
      )}

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <>
          <div className="flex items-center space-x-2">
            {(['today', 'week', 'month'] as const).map(range => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  dateRange === range
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {range.charAt(0).toUpperCase() + range.slice(1)}
              </button>
            ))}
          </div>

          {/* Stats Cards */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <StatCard
                title="Total Ingested"
                value={stats.totalIngested.toLocaleString()}
                color="blue"
              />
              <StatCard
                title="Processed"
                value={stats.totalProcessed.toLocaleString()}
                subtitle={`${stats.successRate.toFixed(1)}% success rate`}
                color="green"
              />
              <StatCard
                title="Failed"
                value={stats.totalFailed.toLocaleString()}
                color="red"
              />
              <StatCard
                title="Avg Processing Time"
                value={`${stats.averageProcessingTime.toFixed(1)}s`}
                color="purple"
              />
            </div>
          )}

          {/* Source Type Breakdown */}
          {stats && Object.keys(stats.bySourceType).length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">By Source Type</h2>
              <div className="space-y-3">
                {Object.entries(stats.bySourceType).map(([sourceType, data]) => (
                  <div key={sourceType} className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 capitalize">{sourceType.replace('_', ' ')}</p>
                      <div className="mt-1 flex items-center space-x-4 text-sm text-gray-600">
                        <span>Ingested: {data.ingested}</span>
                        <span>Processed: {data.processed}</span>
                        <span className="text-red-600">Failed: {data.failed}</span>
                      </div>
                    </div>
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-green-600 h-2 rounded-full"
                        style={{ width: `${(data.processed / data.ingested) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ingestion Log */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Ingestion Log</h2>
              <div className="flex items-center space-x-2">
                {(['all', 'pending', 'processing', 'completed', 'failed'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded text-xs font-medium ${
                      filter === f
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ingested</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Processed</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Confidence</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {log.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No ingestion records found
                  </td>
                </tr>
              ) : (
                log.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900 capitalize">
                      {item.sourceType.replace('_', ' ')}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {item.connectorProvider || 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <StatusBadge status={item.processingStatus} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(item.ingestedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {item.processedAt ? new Date(item.processedAt).toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {item.classificationConfidence !== undefined ? (
                        <span className={`font-medium ${
                          item.classificationConfidence >= 0.9 ? 'text-green-600' :
                          item.classificationConfidence >= 0.7 ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {(item.classificationConfidence * 100).toFixed(0)}%
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
    </div>
  );
}

// CSV Dropzone Component (Chunk 1)
function CSVDropzone({ token }: { token: string }) {
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'text/csv') {
      await uploadFile(file);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadFile(file);
    }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    setUploadStatus(null);

    try {
      const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

      // Get signed URL
      const signedUrlRes = await fetch(`${API_BASE}/api/ingestion/csv/signed-url`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
        }),
      });

      if (!signedUrlRes.ok) {
        throw new Error('Failed to get signed URL');
      }

      const { signedUrl, storageKey, documentId } = await signedUrlRes.json();

      // Upload to S3 (in production, would use signed URL)
      // For now, we'll use a direct upload endpoint
      const formData = new FormData();
      formData.append('file', file);

      // Process CSV
      const processRes = await fetch(`${API_BASE}/api/ingestion/csv/process`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ storageKey, documentId }),
      });

      if (processRes.ok) {
        setUploadStatus('File uploaded and queued for processing');
      } else {
        throw new Error('Failed to process CSV');
      }
    } catch (error) {
      logger.error('CSV upload failed', error);
      setUploadStatus('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors"
    >
      <input
        type="file"
        accept=".csv"
        onChange={handleFileSelect}
        className="hidden"
        id="csv-upload"
      />
      <label htmlFor="csv-upload" className="cursor-pointer">
        <p className="text-gray-600 mb-2">
          {uploading ? 'Uploading...' : 'Drag and drop CSV file here, or click to select'}
        </p>
        {uploadStatus && (
          <p className={`text-sm ${uploadStatus.includes('failed') ? 'text-red-600' : 'text-green-600'}`}>
            {uploadStatus}
          </p>
        )}
      </label>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  color,
}: {
  title: string;
  value: string;
  subtitle?: string;
  color: 'blue' | 'green' | 'red' | 'purple';
}) {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <p className="text-sm font-medium opacity-80">{title}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {subtitle && <p className="text-xs mt-1 opacity-70">{subtitle}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: IngestionLogItem['processingStatus'] }) {
  const colors = {
    pending: 'bg-yellow-100 text-yellow-800',
    processing: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
