'use client';

import React, { useState, useEffect } from 'react';
import { TrendingUp, AlertTriangle, CheckCircle, Activity } from 'lucide-react';

interface SLO {
  id: string;
  serviceName: string;
  sloName: string;
  sloType: 'availability' | 'latency' | 'error_rate' | 'freshness';
  targetPercentage: number;
  currentPercentage?: number;
  status: 'on_track' | 'at_risk' | 'breached';
  errorBudgetRemaining?: number;
  errorBudgetBurnRate?: number;
  lastBreachAt?: string;
}

export default function SLODashboard() {
  const [slos, setSlos] = useState<SLO[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    serviceName: '',
    sloType: '',
    status: '',
  });

  useEffect(() => {
    fetchSLOs();
  }, [filter]);

  const fetchSLOs = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (filter.serviceName) params.append('serviceName', filter.serviceName);
      if (filter.sloType) params.append('sloType', filter.sloType);
      if (filter.status) params.append('status', filter.status);
      params.append('limit', '100');

      const res = await fetch(`/api/monitoring/slos?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setSlos(data.slos || []);
    } catch (error) {
      console.error('Error fetching SLOs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'breached': return 'text-red-700 bg-red-50 border-red-200';
      case 'at_risk': return 'text-yellow-700 bg-yellow-50 border-yellow-200';
      default: return 'text-green-700 bg-green-50 border-green-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'breached': return <AlertTriangle className="w-5 h-5 text-red-600" />;
      case 'at_risk': return <Activity className="w-5 h-5 text-yellow-600" />;
      default: return <CheckCircle className="w-5 h-5 text-green-600" />;
    }
  };

  if (loading) {
    return <div className="p-6">Loading SLOs...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <TrendingUp className="w-8 h-8" />
          Service Level Objectives
        </h1>
        <button
          onClick={fetchSLOs}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Total SLOs</div>
          <div className="text-2xl font-bold">{slos.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">On Track</div>
          <div className="text-2xl font-bold text-green-600">
            {slos.filter((s) => s.status === 'on_track').length}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">At Risk</div>
          <div className="text-2xl font-bold text-yellow-600">
            {slos.filter((s) => s.status === 'at_risk').length}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Breached</div>
          <div className="text-2xl font-bold text-red-600">
            {slos.filter((s) => s.status === 'breached').length}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <input
          type="text"
          placeholder="Service Name"
          value={filter.serviceName}
          onChange={(e) => setFilter({ ...filter, serviceName: e.target.value })}
          className="px-3 py-2 border rounded-lg"
        />
        <select
          value={filter.sloType}
          onChange={(e) => setFilter({ ...filter, sloType: e.target.value })}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="">All Types</option>
          <option value="availability">Availability</option>
          <option value="latency">Latency</option>
          <option value="error_rate">Error Rate</option>
          <option value="freshness">Freshness</option>
        </select>
        <select
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="">All Statuses</option>
          <option value="on_track">On Track</option>
          <option value="at_risk">At Risk</option>
          <option value="breached">Breached</option>
        </select>
      </div>

      {/* SLOs List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Service</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">SLO Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Target</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Error Budget</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {slos.map((slo) => (
              <tr key={slo.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{slo.serviceName}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">{slo.sloName}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm capitalize">{slo.sloType.replace('_', ' ')}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">{slo.targetPercentage}%</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {slo.currentPercentage !== undefined ? `${slo.currentPercentage.toFixed(2)}%` : '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(slo.status)}
                    <span className={`px-2 py-1 rounded text-xs font-medium border ${getStatusColor(slo.status)}`}>
                      {slo.status.replace('_', ' ')}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {slo.errorBudgetRemaining !== undefined ? (
                    <div>
                      <div>{slo.errorBudgetRemaining.toFixed(2)}% remaining</div>
                      {slo.errorBudgetBurnRate !== undefined && (
                        <div className="text-xs text-gray-500">
                          Burn rate: {slo.errorBudgetBurnRate.toFixed(2)}x
                        </div>
                      )}
                    </div>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {slos.length === 0 && (
          <div className="p-6 text-center text-gray-500">No SLOs found</div>
        )}
      </div>
    </div>
  );
}
