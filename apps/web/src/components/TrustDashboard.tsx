'use client';

import React, { useState, useEffect } from 'react';
import { Shield, AlertTriangle, CheckCircle, Clock, TrendingUp, Activity, Lock, FileCheck } from 'lucide-react';

interface TrustMetrics {
  securityEvents: {
    total: number;
    critical: number;
    high: number;
    open: number;
  };
  incidents: {
    total: number;
    sev1: number;
    sev2: number;
    open: number;
    mttr: number;
  };
  slos: {
    onTrack: number;
    atRisk: number;
    breached: number;
    total: number;
  };
  compliance: {
    soc2: number;
    iso27001: number;
    gdpr: number;
    totalControls: number;
    approved: number;
  };
  models: {
    deployed: number;
    driftDetections: number;
    openDrifts: number;
  };
  backups: {
    last24h: number;
    successRate: number;
    lastBackup: string;
  };
}

export default function TrustDashboard() {
  const [metrics, setMetrics] = useState<TrustMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('auth_token') || localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

      const [eventsRes, incidentsRes, slosRes, evidenceRes, modelsRes, backupsRes] = await Promise.all([
        fetch(`${API_BASE}/api/security/events?limit=100`, { headers }).catch(() => ({ ok: false, json: () => Promise.resolve({ events: [], total: 0 }) })),
        fetch(`${API_BASE}/api/security/incidents?limit=100`, { headers }).catch(() => ({ ok: false, json: () => Promise.resolve({ incidents: [], total: 0 }) })),
        fetch(`${API_BASE}/api/monitoring/slos?limit=100`, { headers }).catch(() => ({ ok: false, json: () => Promise.resolve({ slos: [], total: 0 }) })),
        fetch(`${API_BASE}/api/compliance/evidence?complianceFramework=soc2&limit=100`, { headers }).catch(() => ({ ok: false, json: () => Promise.resolve({ evidence: [], total: 0 }) })),
        fetch(`${API_BASE}/api/modelops/models?status=deployed&limit=100`, { headers }).catch(() => ({ ok: false, json: () => Promise.resolve({ models: [] }) })),
        fetch(`${API_BASE}/api/backup/backups?limit=100`, { headers }).catch(() => ({ ok: false, json: () => Promise.resolve({ logs: [] }) })),
      ]);

      const [events, incidents, slos, evidence, models, backups] = await Promise.all([
        eventsRes.json(),
        incidentsRes.json(),
        slosRes.json(),
        evidenceRes.json(),
        modelsRes.json(),
        backupsRes.json(),
      ]);

      // Calculate metrics from responses
      const securityEvents = {
        total: events.total || 0,
        critical: events.events?.filter((e: any) => e.severity === 'critical').length || 0,
        high: events.events?.filter((e: any) => e.severity === 'high').length || 0,
        open: events.events?.filter((e: any) => e.status === 'open').length || 0,
      };

      const incidentsData = {
        total: incidents.total || 0,
        sev1: incidents.incidents?.filter((i: any) => i.severity === 'sev1').length || 0,
        sev2: incidents.incidents?.filter((i: any) => i.severity === 'sev2').length || 0,
        open: incidents.incidents?.filter((i: any) => i.status === 'open').length || 0,
        mttr: incidents.incidents?.reduce((acc: number, i: any) => acc + (i.mttrMinutes || 0), 0) / (incidents.incidents?.length || 1),
      };

      const slosData = {
        total: slos.total || 0,
        onTrack: slos.slos?.filter((s: any) => s.status === 'on_track').length || 0,
        atRisk: slos.slos?.filter((s: any) => s.status === 'at_risk').length || 0,
        breached: slos.slos?.filter((s: any) => s.status === 'breached').length || 0,
      };

      const complianceData = {
        soc2: evidence.evidence?.filter((e: any) => e.complianceFramework === 'soc2').length || 0,
        iso27001: evidence.evidence?.filter((e: any) => e.complianceFramework === 'iso27001').length || 0,
        gdpr: evidence.evidence?.filter((e: any) => e.complianceFramework === 'gdpr').length || 0,
        totalControls: evidence.total || 0,
        approved: evidence.evidence?.filter((e: any) => e.status === 'approved').length || 0,
      };

      const modelsData = {
        deployed: models.models?.length || 0,
        driftDetections: 0, // Would need separate API call
        openDrifts: 0, // Would need separate API call
      };

      const backupsData = {
        last24h: backups.logs?.filter((b: any) => {
          const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          return new Date(b.backupStartedAt) > dayAgo;
        }).length || 0,
        successRate: backups.logs?.filter((b: any) => b.backupStatus === 'completed').length / (backups.logs?.length || 1) * 100 || 0,
        lastBackup: backups.logs?.[0]?.backupStartedAt || 'Never',
      };

      setMetrics({
        securityEvents,
        incidents: incidentsData,
        slos: slosData,
        compliance: complianceData,
        models: modelsData,
        backups: backupsData,
      });
    } catch (error) {
      console.error('Error fetching trust metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-6">Loading trust metrics...</div>;
  }

  if (!metrics) {
    return <div className="p-6 text-red-600">Failed to load trust metrics</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Trust Dashboard</h1>
        <button
          onClick={fetchMetrics}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Refresh
        </button>
      </div>

      {/* Security Events */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Security Events"
          value={metrics.securityEvents.total}
          subtitle={`${metrics.securityEvents.critical} critical, ${metrics.securityEvents.high} high`}
          icon={<Shield className="w-6 h-6" />}
          color={metrics.securityEvents.critical > 0 ? 'red' : metrics.securityEvents.high > 0 ? 'yellow' : 'green'}
        />
        <MetricCard
          title="Open Incidents"
          value={metrics.incidents.open}
          subtitle={`${metrics.incidents.sev1} Sev1, ${metrics.incidents.sev2} Sev2`}
          icon={<AlertTriangle className="w-6 h-6" />}
          color={metrics.incidents.sev1 > 0 ? 'red' : metrics.incidents.sev2 > 0 ? 'yellow' : 'green'}
        />
        <MetricCard
          title="SLO Status"
          value={`${metrics.slos.onTrack}/${metrics.slos.total}`}
          subtitle={`${metrics.slos.breached} breached, ${metrics.slos.atRisk} at risk`}
          icon={<TrendingUp className="w-6 h-6" />}
          color={metrics.slos.breached > 0 ? 'red' : metrics.slos.atRisk > 0 ? 'yellow' : 'green'}
        />
        <MetricCard
          title="Compliance"
          value={`${metrics.compliance.approved}/${metrics.compliance.totalControls}`}
          subtitle="Controls approved"
          icon={<FileCheck className="w-6 h-6" />}
          color={metrics.compliance.approved / metrics.compliance.totalControls > 0.9 ? 'green' : 'yellow'}
        />
      </div>

      {/* Detailed Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5" />
            System Health
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span>Mean Time To Resolve (MTTR)</span>
              <span className="font-semibold">{Math.round(metrics.incidents.mttr)} min</span>
            </div>
            <div className="flex justify-between">
              <span>Deployed Models</span>
              <span className="font-semibold">{metrics.models.deployed}</span>
            </div>
            <div className="flex justify-between">
              <span>Backup Success Rate</span>
              <span className="font-semibold">{metrics.backups.successRate.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span>Last Backup</span>
              <span className="font-semibold text-sm">
                {new Date(metrics.backups.lastBackup).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Compliance Frameworks
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span>SOC 2</span>
              <span className="font-semibold">{metrics.compliance.soc2} controls</span>
            </div>
            <div className="flex justify-between">
              <span>ISO 27001</span>
              <span className="font-semibold">{metrics.compliance.iso27001} controls</span>
            </div>
            <div className="flex justify-between">
              <span>GDPR</span>
              <span className="font-semibold">{metrics.compliance.gdpr} controls</span>
            </div>
            <div className="flex justify-between">
              <span>Overall Approval</span>
              <span className="font-semibold">
                {((metrics.compliance.approved / metrics.compliance.totalControls) * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  color,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  color: 'red' | 'yellow' | 'green';
}) {
  const colorClasses = {
    red: 'bg-red-50 border-red-200 text-red-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    green: 'bg-green-50 border-green-200 text-green-700',
  };

  return (
    <div className={`bg-white rounded-lg shadow p-6 border-2 ${colorClasses[color]}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">{title}</h3>
        {icon}
      </div>
      <div className="text-3xl font-bold mb-1">{value}</div>
      <div className="text-sm opacity-75">{subtitle}</div>
    </div>
  );
}
