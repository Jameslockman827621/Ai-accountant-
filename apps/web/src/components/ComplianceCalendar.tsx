'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ComplianceCalendar');

interface ComplianceObligation {
  id: string;
  obligationType: 'filing' | 'payment' | 'deadline';
  jurisdiction: string;
  filingType?: string;
  dueDate: string;
  periodStart?: string;
  periodEnd?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'missed' | 'waived';
  filingId?: string;
  readinessScore: number;
  readinessDetails: {
    dataCompleteness: number;
    reconciliationStatus: string;
    connectorHealth: Record<string, string>;
    outstandingTasks: string[];
  };
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface ComplianceCalendarProps {
  token: string;
  tenantId?: string;
}

export default function ComplianceCalendar({ token, tenantId }: ComplianceCalendarProps) {
  const [obligations, setObligations] = useState<ComplianceObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedObligation, setSelectedObligation] = useState<ComplianceObligation | null>(null);
  const [view, setView] = useState<'calendar' | 'list'>('list');
  const [filter, setFilter] = useState<'all' | 'pending' | 'upcoming'>('upcoming');

  useEffect(() => {
    loadCalendar();
    const interval = setInterval(loadCalendar, 300000); // Refresh every 5 minutes
    return () => clearInterval(interval);
  }, []);

  const loadCalendar = async () => {
    try {
      const startDate = new Date().toISOString().split('T')[0];
      const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const response = await fetch(
        `${API_BASE}/api/compliance/calendar?startDate=${startDate}&endDate=${endDate}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) throw new Error('Failed to load calendar');

      const data = await response.json();
      setObligations(data.calendar || []);
    } catch (error) {
      logger.error('Failed to load compliance calendar', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredObligations = obligations.filter(ob => {
    if (filter === 'pending') return ob.status === 'pending' || ob.status === 'in_progress';
    if (filter === 'upcoming') {
      const dueDate = new Date(ob.dueDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return dueDate >= today && (ob.status === 'pending' || ob.status === 'in_progress');
    }
    return true;
  });

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
          <h1 className="text-3xl font-bold text-gray-900">Compliance Calendar</h1>
          <p className="text-gray-600 mt-1">Track filing obligations and deadlines</p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setView('list')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              view === 'list'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            List
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              view === 'calendar'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Calendar
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center space-x-2">
        {(['all', 'upcoming', 'pending'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Obligations List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {filteredObligations.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
              <p className="text-gray-500">No obligations found</p>
            </div>
          ) : (
            filteredObligations.map(obligation => (
              <div
                key={obligation.id}
                onClick={() => setSelectedObligation(obligation)}
                className={`rounded-lg border p-4 cursor-pointer transition-all ${
                  selectedObligation?.id === obligation.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <StatusBadge status={obligation.status} />
                      <ReadinessBadge score={obligation.readinessScore} />
                      <span className="text-xs text-gray-500 uppercase">
                        {obligation.jurisdiction}
                      </span>
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1">
                      {obligation.filingType || obligation.obligationType}
                    </h3>
                    <div className="flex items-center space-x-4 text-sm text-gray-600 mb-2">
                      {obligation.periodStart && obligation.periodEnd && (
                        <span>
                          {new Date(obligation.periodStart).toLocaleDateString()} -{' '}
                          {new Date(obligation.periodEnd).toLocaleDateString()}
                        </span>
                      )}
                      <span className="font-medium">
                        Due: {new Date(obligation.dueDate).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 text-xs text-gray-500">
                      <span>
                        Data: {obligation.readinessDetails.dataCompleteness}%
                      </span>
                      <span>•</span>
                      <span>
                        Reconciliation: {obligation.readinessDetails.reconciliationStatus}
                      </span>
                    </div>
                  </div>
                  {obligation.status === 'pending' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        // Navigate to filing creation
                        window.location.href = `/filings/create?obligationId=${obligation.id}`;
                      }}
                      className="ml-4 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Prepare
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Obligation Detail */}
        <div className="lg:col-span-1">
          {selectedObligation ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 sticky top-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Obligation Details</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <p className="text-sm text-gray-900 capitalize">
                    {selectedObligation.obligationType}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Filing Type</label>
                  <p className="text-sm text-gray-900">{selectedObligation.filingType || 'N/A'}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <p className="text-sm text-gray-900">
                    {new Date(selectedObligation.dueDate).toLocaleDateString()}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Readiness Score
                  </label>
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-600">Overall</span>
                      <span className="text-sm font-medium text-gray-900">
                        {selectedObligation.readinessScore}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          selectedObligation.readinessScore >= 80
                            ? 'bg-green-600'
                            : selectedObligation.readinessScore >= 50
                            ? 'bg-yellow-600'
                            : 'bg-red-600'
                        }`}
                        style={{ width: `${selectedObligation.readinessScore}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Readiness Details
                  </label>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Data Completeness</span>
                      <span className="font-medium">
                        {selectedObligation.readinessDetails.dataCompleteness}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Reconciliation</span>
                      <span className="font-medium capitalize">
                        {selectedObligation.readinessDetails.reconciliationStatus}
                      </span>
                    </div>
                    {selectedObligation.readinessDetails.outstandingTasks.length > 0 && (
                      <div>
                        <span className="text-gray-600">Outstanding Tasks:</span>
                        <ul className="list-disc list-inside mt-1 text-gray-900">
                          {selectedObligation.readinessDetails.outstandingTasks.map((task, idx) => (
                            <li key={idx}>{task}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {selectedObligation.status === 'pending' && (
                  <button
                    onClick={() => {
                      window.location.href = `/filings/create?obligationId=${selectedObligation.id}`;
                    }}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Prepare Filing
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
              Select an obligation to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ComplianceObligation['status'] }) {
  const colors = {
    pending: 'bg-yellow-100 text-yellow-800',
    in_progress: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    missed: 'bg-red-100 text-red-800',
    waived: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
    </span>
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
