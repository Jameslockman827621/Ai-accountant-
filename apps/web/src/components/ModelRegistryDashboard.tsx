'use client';

import React, { useState, useEffect } from 'react';
import { Brain, AlertTriangle } from 'lucide-react';

interface Model {
  id: string;
  modelName: string;
  modelType: string;
  version: string;
  status: 'draft' | 'training' | 'evaluating' | 'approved' | 'deployed' | 'deprecated';
  deployedAt?: string;
  rolloutPercentage: number;
  evaluationMetrics?: Record<string, unknown>;
}

interface DriftDetection {
  id: string;
  modelId: string;
  driftType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detectedAt: string;
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  driftScore?: number;
}

export default function ModelRegistryDashboard() {
  const [models, setModels] = useState<Model[]>([]);
  const [drifts, setDrifts] = useState<DriftDetection[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', modelType: '' });

  useEffect(() => {
    fetchData();
  }, [filter]);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (filter.status) params.append('status', filter.status);
      if (filter.modelType) params.append('modelType', filter.modelType);
      params.append('limit', '100');

      const [modelsRes, driftsRes] = await Promise.all([
        fetch(`/api/modelops/models?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/modelops/drift-detections?status=open&limit=20', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const [modelsData, driftsData] = await Promise.all([
        modelsRes.json(),
        driftsRes.json(),
      ]);

      setModels(modelsData.models || []);
      setDrifts(driftsData.detections || []);
    } catch (error) {
      console.error('Error fetching model data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'deployed': return 'text-green-700 bg-green-50 border-green-200';
      case 'approved': return 'text-blue-700 bg-blue-50 border-blue-200';
      case 'evaluating': return 'text-yellow-700 bg-yellow-50 border-yellow-200';
      case 'deprecated': return 'text-gray-700 bg-gray-50 border-gray-200';
      default: return 'text-gray-700 bg-gray-50 border-gray-200';
    }
  };

  if (loading) {
    return <div className="p-6">Loading model registry...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Brain className="w-8 h-8" />
          Model Registry
        </h1>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Refresh
        </button>
      </div>

      {/* Alerts */}
      {drifts.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
            <h3 className="font-semibold text-yellow-800">
              {drifts.length} Open Drift Detection{drifts.length !== 1 ? 's' : ''}
            </h3>
          </div>
          <div className="text-sm text-yellow-700">
            {drifts.filter((d) => d.severity === 'critical' || d.severity === 'high').length} high/critical severity
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Total Models</div>
          <div className="text-2xl font-bold">{models.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Deployed</div>
          <div className="text-2xl font-bold text-green-600">
            {models.filter((m) => m.status === 'deployed').length}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Open Drifts</div>
          <div className="text-2xl font-bold text-yellow-600">{drifts.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">In Evaluation</div>
          <div className="text-2xl font-bold text-blue-600">
            {models.filter((m) => m.status === 'evaluating').length}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <select
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="training">Training</option>
          <option value="evaluating">Evaluating</option>
          <option value="approved">Approved</option>
          <option value="deployed">Deployed</option>
          <option value="deprecated">Deprecated</option>
        </select>
        <select
          value={filter.modelType}
          onChange={(e) => setFilter({ ...filter, modelType: e.target.value })}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="">All Types</option>
          <option value="classification">Classification</option>
          <option value="extraction">Extraction</option>
          <option value="prediction">Prediction</option>
        </select>
      </div>

      {/* Models List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Model</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Version</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rollout</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Deployed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {models.map((model) => (
              <tr key={model.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{model.modelName}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm capitalize">{model.modelType}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">{model.version}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 rounded text-xs font-medium border ${getStatusColor(model.status)}`}>
                    {model.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {model.status === 'deployed' ? `${model.rolloutPercentage}%` : '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {model.deployedAt ? new Date(model.deployedAt).toLocaleDateString() : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {models.length === 0 && (
          <div className="p-6 text-center text-gray-500">No models found</div>
        )}
      </div>
    </div>
  );
}
