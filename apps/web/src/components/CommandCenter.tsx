'use client';

import { useState, useEffect } from 'react';

interface CommandCenterProps {
  token: string;
  tenantId: string;
}

interface DashboardStats {
  unprocessedDocuments: number;
  unmatchedTransactions: number;
  pendingExceptions: number;
  connectorHealth: Array<{
    name: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    lastSync: Date;
  }>;
  recentActivity: Array<{
    type: string;
    message: string;
    timestamp: Date;
  }>;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function CommandCenter({ token, tenantId }: CommandCenterProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'inbox' | 'reconciliation' | 'exceptions' | 'connectors'>('overview');

  useEffect(() => {
    loadDashboardStats();
    const interval = setInterval(loadDashboardStats, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [tenantId]);

  const loadDashboardStats = async () => {
    try {
      // In production, would call dedicated dashboard API
      const stats: DashboardStats = {
        unprocessedDocuments: 12,
        unmatchedTransactions: 8,
        pendingExceptions: 3,
        connectorHealth: [
          { name: 'Plaid - Business Account', status: 'healthy', lastSync: new Date() },
          { name: 'Shopify', status: 'healthy', lastSync: new Date() },
          { name: 'Stripe', status: 'degraded', lastSync: new Date(Date.now() - 2 * 60 * 60 * 1000) },
        ],
        recentActivity: [
          { type: 'document', message: 'Invoice INV-001 processed', timestamp: new Date() },
          { type: 'reconciliation', message: '5 transactions matched', timestamp: new Date() },
          { type: 'exception', message: 'Low confidence classification requires review', timestamp: new Date() },
        ],
      };

      setStats(stats);
    } catch (error) {
      console.error('Failed to load dashboard stats', error);
    } finally {
      setIsLoading(false);
    }
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

  if (!stats) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Command Center</h1>
          <p className="text-gray-600 mt-1">Your financial operations dashboard</p>
        </div>
        <div className="text-sm text-gray-500">
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard
          title="Unprocessed Documents"
          value={stats.unprocessedDocuments}
          trend="+2"
          trendUp={false}
          color="blue"
          actionUrl="/documents"
        />
        <MetricCard
          title="Unmatched Transactions"
          value={stats.unmatchedTransactions}
          trend="-3"
          trendUp={true}
          color="orange"
          actionUrl="/reconciliation"
        />
        <MetricCard
          title="Pending Exceptions"
          value={stats.pendingExceptions}
          trend="+1"
          trendUp={false}
          color="red"
          actionUrl="/exceptions"
        />
        <MetricCard
          title="Healthy Connectors"
          value={stats.connectorHealth.filter(c => c.status === 'healthy').length}
          total={stats.connectorHealth.length}
          color="green"
          actionUrl="/connectors"
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'inbox', label: 'Inbox' },
            { id: 'reconciliation', label: 'Reconciliation' },
            { id: 'exceptions', label: 'Exceptions' },
            { id: 'connectors', label: 'Connectors' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id as any)}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                selectedTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {selectedTab === 'overview' && <OverviewTab stats={stats} />}
        {selectedTab === 'inbox' && <InboxTab token={token} />}
        {selectedTab === 'reconciliation' && <ReconciliationTab token={token} />}
        {selectedTab === 'exceptions' && <ExceptionsTab token={token} />}
        {selectedTab === 'connectors' && <ConnectorsTab stats={stats} />}
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  trend,
  trendUp,
  color,
  total,
  actionUrl,
}: {
  title: string;
  value: number;
  trend?: string;
  trendUp?: boolean;
  color: 'blue' | 'orange' | 'red' | 'green';
  total?: number;
  actionUrl?: string;
}) {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    green: 'bg-green-50 border-green-200 text-green-700',
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium opacity-80">{title}</p>
          <p className="text-2xl font-bold mt-1">
            {value}
            {total !== undefined && <span className="text-lg opacity-70">/{total}</span>}
          </p>
          {trend && (
            <p className={`text-xs mt-1 ${trendUp ? 'text-green-600' : 'text-red-600'}`}>
              {trendUp ? '↓' : '↑'} {trend} from yesterday
            </p>
          )}
        </div>
        {actionUrl && (
          <a
            href={actionUrl}
            className="text-sm font-medium underline hover:opacity-80"
          >
            View →
          </a>
        )}
      </div>
    </div>
  );
}

function OverviewTab({ stats }: { stats: DashboardStats }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Recent Activity */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
        <div className="space-y-3">
          {stats.recentActivity.map((activity, index) => (
            <div key={index} className="flex items-start space-x-3">
              <div className="w-2 h-2 rounded-full bg-blue-500 mt-2"></div>
              <div className="flex-1">
                <p className="text-sm text-gray-900">{activity.message}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {activity.timestamp.toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Connector Health */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Connector Health</h2>
        <div className="space-y-3">
          {stats.connectorHealth.map((connector, index) => (
            <div key={index} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{connector.name}</p>
                <p className="text-xs text-gray-500">
                  Last sync: {connector.lastSync.toLocaleTimeString()}
                </p>
              </div>
              <StatusBadge status={connector.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InboxTab({ token }: { token: string }) {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/ingestion/log?status=pending&limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setDocuments(data.log || []);
      }
    } catch (error) {
      console.error('Failed to load documents', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Document Inbox</h2>
      {documents.length === 0 ? (
        <p className="text-gray-600">No documents awaiting processing.</p>
      ) : (
        <div className="space-y-3">
          {documents.map((doc: any) => (
            <div key={doc.id} className="p-3 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium text-gray-900 capitalize">{doc.source_type}</p>
              <p className="text-xs text-gray-500 mt-1">
                Ingested: {new Date(doc.ingested_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReconciliationTab({ token }: { token: string }) {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSummary();
  }, []);

  const loadSummary = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/reconciliation/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setSummary(data.summary);
      }
    } catch (error) {
      console.error('Failed to load reconciliation summary', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Reconciliation Status</h2>
      {summary ? (
        <div className="grid grid-cols-3 gap-4">
          <div className="p-3 bg-blue-50 rounded-lg">
            <p className="text-sm text-gray-600">Unmatched</p>
            <p className="text-2xl font-bold text-blue-600">{summary.unmatchedCount || 0}</p>
          </div>
          <div className="p-3 bg-green-50 rounded-lg">
            <p className="text-sm text-gray-600">Matched</p>
            <p className="text-2xl font-bold text-green-600">{summary.matchedCount || 0}</p>
          </div>
          <div className="p-3 bg-yellow-50 rounded-lg">
            <p className="text-sm text-gray-600">Partial</p>
            <p className="text-2xl font-bold text-yellow-600">{summary.partialCount || 0}</p>
          </div>
        </div>
      ) : (
        <p className="text-gray-600">No reconciliation data available.</p>
      )}
    </div>
  );
}

function ExceptionsTab({ token }: { token: string }) {
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadExceptions();
  }, []);

  const loadExceptions = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/reconciliation/exceptions?status=open`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setExceptions(data.exceptions || []);
      }
    } catch (error) {
      console.error('Failed to load exceptions', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Exception Queue</h2>
      {exceptions.length === 0 ? (
        <p className="text-gray-600">No exceptions requiring review.</p>
      ) : (
        <div className="space-y-3">
          {exceptions.slice(0, 5).map((exc: any) => (
            <div key={exc.id} className="p-3 bg-red-50 rounded-lg">
              <p className="text-sm font-medium text-gray-900">{exc.title || 'Exception'}</p>
              <p className="text-xs text-gray-600 mt-1">{exc.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectorsTab({ stats }: { stats: DashboardStats }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Connector Status</h2>
      <div className="space-y-4">
        {stats.connectorHealth.map((connector, index) => (
          <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">{connector.name}</p>
              <p className="text-sm text-gray-500 mt-1">
                Last sync: {connector.lastSync.toLocaleString()}
              </p>
            </div>
            <StatusBadge status={connector.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: 'healthy' | 'degraded' | 'unhealthy' }) {
  const colors = {
    healthy: 'bg-green-100 text-green-800',
    degraded: 'bg-yellow-100 text-yellow-800',
    unhealthy: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${colors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
