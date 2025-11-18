'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';
import { toError } from '@/utils/error';

const logger = createLogger('AccountantPortal');

interface FirmOverview {
  firmId: string;
  firmName: string;
  totalClients: number;
  activeClients: number;
  totalRevenue: number;
  pendingApprovals: number;
  complianceStatus: {
    onTrack: number;
    atRisk: number;
    overdue: number;
  };
  clientHealth: Array<{
    clientId: string;
    clientName: string;
    healthScore: number;
    pendingTasks: number;
    upcomingDeadlines: number;
  }>;
}

interface ClientSummary {
  clientId: string;
  clientName: string;
  healthScore: number;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  upcomingDeadlines: number;
  overdueDeadlines: number;
  slaAdherence: number;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface AccountantPortalProps {
  token: string;
  userId: string;
}

export default function AccountantPortal({ token, userId: _userId }: AccountantPortalProps) {
  const [overview, setOverview] = useState<FirmOverview | null>(null);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [clientSummary, setClientSummary] = useState<ClientSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadOverview();
  }, []);

  useEffect(() => {
    if (selectedClient) {
      loadClientSummary(selectedClient);
    }
  }, [selectedClient]);

  const loadOverview = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/accountant/firm/overview`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load overview');

      const data = await response.json();
      setOverview(data.overview);
    } catch (error) {
      const err = toError(error, 'Failed to load firm overview');
      logger.error('Failed to load firm overview', err);
    } finally {
      setLoading(false);
    }
  };

  const loadClientSummary = async (clientTenantId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/accountant/firm/clients/${clientTenantId}/summary`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setClientSummary(data.summary);
      }
    } catch (error) {
      const err = toError(error, 'Failed to load client summary');
      logger.error('Failed to load client summary', err);
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

  if (!overview) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
        Firm overview not available
      </div>
    );
  }

  const filteredClients = overview.clientHealth.filter(client =>
    client.clientName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Accountant Portal</h1>
          <p className="text-gray-600 mt-1">{overview.firmName}</p>
        </div>
        <div className="text-sm text-gray-500">
          {overview.activeClients} active clients
        </div>
      </div>

      {/* Firm Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard title="Total Clients" value={overview.totalClients} color="blue" />
        <MetricCard title="Active Clients" value={overview.activeClients} color="green" />
        <MetricCard title="Pending Approvals" value={overview.pendingApprovals} color="orange" />
        <MetricCard title="On Track" value={overview.complianceStatus.onTrack} color="green" />
      </div>

      {/* Compliance Status */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Compliance Status</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <p className="text-sm font-medium text-green-900 mb-1">On Track</p>
            <p className="text-2xl font-bold text-green-600">{overview.complianceStatus.onTrack}</p>
          </div>
          <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <p className="text-sm font-medium text-yellow-900 mb-1">At Risk</p>
            <p className="text-2xl font-bold text-yellow-600">{overview.complianceStatus.atRisk}</p>
          </div>
          <div className="p-4 bg-red-50 rounded-lg border border-red-200">
            <p className="text-sm font-medium text-red-900 mb-1">Overdue</p>
            <p className="text-2xl font-bold text-red-600">{overview.complianceStatus.overdue}</p>
          </div>
        </div>
      </div>

      {/* Client List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Clients</h2>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search clients..."
                className="px-3 py-1 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="space-y-3">
              {filteredClients.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No clients found</p>
              ) : (
                filteredClients.map(client => (
                  <div
                    key={client.clientId}
                    onClick={() => setSelectedClient(client.clientId)}
                    className={`p-4 rounded-lg border cursor-pointer transition-all ${
                      selectedClient === client.clientId
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 mb-1">{client.clientName}</h3>
                        <div className="flex items-center space-x-4 text-sm text-gray-600">
                          <span>Health: {client.healthScore}%</span>
                          <span>Tasks: {client.pendingTasks}</span>
                          <span>Deadlines: {client.upcomingDeadlines}</span>
                        </div>
                      </div>
                      <HealthBadge score={client.healthScore} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Client Summary */}
        <div className="lg:col-span-1">
          {clientSummary ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 sticky top-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Client Summary</h2>
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">Client</p>
                  <p className="text-lg font-semibold text-gray-900">{clientSummary.clientName}</p>
                </div>

                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">Health Score</p>
                  <div className="flex items-center space-x-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          clientSummary.healthScore >= 80
                            ? 'bg-green-600'
                            : clientSummary.healthScore >= 50
                            ? 'bg-yellow-600'
                            : 'bg-red-600'
                        }`}
                        style={{ width: `${clientSummary.healthScore}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium">{clientSummary.healthScore}%</span>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Task Status</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Pending</span>
                      <span className="font-medium">{clientSummary.pendingTasks}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">In Progress</span>
                      <span className="font-medium">{clientSummary.inProgressTasks}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Completed</span>
                      <span className="font-medium">{clientSummary.completedTasks}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Deadlines</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Upcoming</span>
                      <span className="font-medium">{clientSummary.upcomingDeadlines}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Overdue</span>
                      <span className="font-medium text-red-600">{clientSummary.overdueDeadlines}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">SLA Adherence</p>
                  <p className="text-lg font-bold text-gray-900">{clientSummary.slaAdherence.toFixed(1)}%</p>
                </div>

                <button
                  onClick={() => {
                    window.location.href = `/clients/${clientSummary.clientId}`;
                  }}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  View Client Details
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
              Select a client to view summary
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, color }: { title: string; value: number; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    red: 'bg-red-50 border-red-200 text-red-700',
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <p className="text-sm font-medium opacity-80">{title}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}

function HealthBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-green-100 text-green-800' : score >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';

  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${color}`}>
      {score}% Health
    </span>
  );
}
