'use client';

import React, { useState, useEffect } from 'react';
import { FileCheck, CheckCircle, Clock, AlertCircle } from 'lucide-react';

interface ComplianceEvidence {
  id: string;
  complianceFramework: 'soc2' | 'iso27001' | 'gdpr' | 'hipaa' | 'other';
  controlId: string;
  controlName: string;
  evidenceType: string;
  status: 'draft' | 'reviewed' | 'approved' | 'expired';
  effectiveFrom?: string;
  effectiveTo?: string;
  nextReviewDue?: string;
}

export default function ComplianceEvidenceDashboard() {
  const [evidence, setEvidence] = useState<ComplianceEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    complianceFramework: 'soc2',
    status: '',
  });

  useEffect(() => {
    fetchEvidence();
  }, [filter]);

  const fetchEvidence = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      params.append('complianceFramework', filter.complianceFramework);
      if (filter.status) params.append('status', filter.status);
      params.append('limit', '100');

      const res = await fetch(`/api/compliance/evidence?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setEvidence(data.evidence || []);
    } catch (error) {
      console.error('Error fetching compliance evidence:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'text-green-700 bg-green-50 border-green-200';
      case 'reviewed': return 'text-blue-700 bg-blue-50 border-blue-200';
      case 'draft': return 'text-gray-700 bg-gray-50 border-gray-200';
      case 'expired': return 'text-red-700 bg-red-50 border-red-200';
      default: return 'text-gray-700 bg-gray-50 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'reviewed': return <Clock className="w-4 h-4 text-blue-600" />;
      case 'expired': return <AlertCircle className="w-4 h-4 text-red-600" />;
      default: return <FileCheck className="w-4 h-4 text-gray-600" />;
    }
  };

  if (loading) {
    return <div className="p-6">Loading compliance evidence...</div>;
  }

  const approvedCount = evidence.filter((e) => e.status === 'approved').length;
  const approvalRate = evidence.length > 0 ? (approvedCount / evidence.length) * 100 : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <FileCheck className="w-8 h-8" />
          Compliance Evidence
        </h1>
        <button
          onClick={fetchEvidence}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Total Controls</div>
          <div className="text-2xl font-bold">{evidence.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Approved</div>
          <div className="text-2xl font-bold text-green-600">{approvedCount}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Approval Rate</div>
          <div className="text-2xl font-bold">{approvalRate.toFixed(1)}%</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Draft</div>
          <div className="text-2xl font-bold text-gray-600">
            {evidence.filter((e) => e.status === 'draft').length}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <select
          value={filter.complianceFramework}
          onChange={(e) => setFilter({ ...filter, complianceFramework: e.target.value as any })}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="soc2">SOC 2</option>
          <option value="iso27001">ISO 27001</option>
          <option value="gdpr">GDPR</option>
          <option value="hipaa">HIPAA</option>
        </select>
        <select
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="reviewed">Reviewed</option>
          <option value="approved">Approved</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Evidence List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Control ID</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Control Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Evidence Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Effective From</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Next Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {evidence.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono">{item.controlId}</td>
                <td className="px-6 py-4 text-sm">{item.controlName}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm capitalize">{item.evidenceType.replace('_', ' ')}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(item.status)}
                    <span className={`px-2 py-1 rounded text-xs font-medium border ${getStatusColor(item.status)}`}>
                      {item.status}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {item.effectiveFrom ? new Date(item.effectiveFrom).toLocaleDateString() : '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {item.nextReviewDue ? (
                    <span className={new Date(item.nextReviewDue) < new Date() ? 'text-red-600 font-semibold' : ''}>
                      {new Date(item.nextReviewDue).toLocaleDateString()}
                    </span>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {evidence.length === 0 && (
          <div className="p-6 text-center text-gray-500">No compliance evidence found</div>
        )}
      </div>
    </div>
  );
}
