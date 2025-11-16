'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('SLO-Dashboard');

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface SLODefinition {
  id: string;
  sloName: string;
  serviceName: string;
  metricName: string;
  targetValue: number;
  windowDays: number;
  description: string | null;
}

interface SLOStatus {
  slo: SLODefinition;
  currentValue: number;
  errorBudget: number;
  status: 'healthy' | 'warning' | 'breached';
  trend: 'improving' | 'stable' | 'degrading';
}

interface AlertFire {
  id: string;
  ruleName: string;
  severity: 'info' | 'warning' | 'critical';
  firedAt: string;
  metricValue: number;
  runbookUrl: string | null;
}

interface SLODashboardProps {
  token: string;
}

/**
 * SLO Dashboard Component (Chunk 2)
 * Summarizes SLO status, error budgets, and active incidents
 */
export default function SLODashboard({ token }: SLODashboardProps) {
  const [slos, setSlos] = useState<SLOStatus[]>([]);
  const [alerts, setAlerts] = useState<AlertFire[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      // Load SLOs
      const slosRes = await fetch(`${API_BASE}/api/monitoring/slos`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (slosRes.ok) {
        const slosData = await slosRes.json();
        setSlos(slosData.slos || []);
      }

      // Load active alerts
      const alertsRes = await fetch(`${API_BASE}/api/monitoring/alerts/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (alertsRes.ok) {
        const alertsData = await alertsRes.json();
        setAlerts(alertsData.alerts || []);
      }
    } catch (error) {
      logger.error('Failed to load SLO data', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'breached':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 text-red-800';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800';
      case 'info':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
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
          <h1 className="text-3xl font-bold text-gray-900">SLO Dashboard</h1>
          <p className="text-gray-600 mt-1">Service Level Objectives and Error Budgets</p>
        </div>
      </div>

      {/* Active Alerts */}
      {alerts.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <h2 className="text-lg font-semibold text-red-900 mb-4">Active Incidents</h2>
          <div className="space-y-3">
            {alerts.map(alert => (
              <div key={alert.id} className="bg-white rounded-lg p-4 border border-red-200">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getSeverityColor(alert.severity)}`}>
                        {alert.severity.toUpperCase()}
                      </span>
                      <span className="font-semibold text-gray-900">{alert.ruleName}</span>
                    </div>
                    <p className="text-sm text-gray-600">
                      Metric Value: {alert.metricValue.toFixed(2)} | Fired: {new Date(alert.firedAt).toLocaleString()}
                    </p>
                  </div>
                  {alert.runbookUrl && (
                    <a
                      href={alert.runbookUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-4 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Runbook
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SLO Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {slos.map(slo => (
          <div
            key={slo.slo.id}
            className={`rounded-lg border-2 p-6 ${getStatusColor(slo.status)}`}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-lg">{slo.slo.sloName}</h3>
              <span className="text-xs font-medium px-2 py-1 rounded bg-white bg-opacity-50">
                {slo.status.toUpperCase()}
              </span>
            </div>
            <p className="text-sm opacity-80 mb-4">{slo.slo.serviceName}</p>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Current Value:</span>
                <span className="font-medium">{slo.currentValue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Target:</span>
                <span className="font-medium">{slo.slo.targetValue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Error Budget:</span>
                <span className="font-medium">{(slo.errorBudget * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Trend:</span>
                <span className="font-medium capitalize">{slo.trend}</span>
              </div>
            </div>

            {/* Error Budget Bar */}
            <div className="mt-4">
              <div className="w-full bg-white bg-opacity-50 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${
                    slo.errorBudget > 0.5 ? 'bg-green-600' : slo.errorBudget > 0.2 ? 'bg-yellow-600' : 'bg-red-600'
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, slo.errorBudget * 100))}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {slos.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <p>No SLOs configured</p>
        </div>
      )}
    </div>
  );
}
