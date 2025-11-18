'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ExceptionQueue');

interface ExceptionItem {
  id: string;
  type: 'classification' | 'reconciliation' | 'ingestion' | 'validation';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_review' | 'resolved';
  title: string;
  description: string;
  documentId?: string;
  transactionId?: string;
  createdAt: string;
  assignedTo?: string;
  resolution?: string;
  resolvedAt?: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface ExceptionQueueProps {
  token: string;
  tenantId: string;
}

export default function ExceptionQueue({ token, tenantId: _tenantId }: ExceptionQueueProps) {
  const [exceptions, setExceptions] = useState<ExceptionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'in_review' | 'resolved'>('open');
  const [selectedException, setSelectedException] = useState<ExceptionItem | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');

  useEffect(() => {
    loadExceptions();
    const interval = setInterval(loadExceptions, 30000);
    return () => clearInterval(interval);
  }, [filter]);

  const loadExceptions = async () => {
    try {
      const status = filter === 'all' ? undefined : filter;
      const params = status ? `?status=${status}` : '';
      
      const response = await fetch(`${API_BASE}/api/reconciliation/exceptions${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load exceptions');

      const data = await response.json();
      setExceptions(data.exceptions || []);
    } catch (error) {
      logger.error('Failed to load exceptions', error);
    } finally {
      setLoading(false);
    }
  };

  const claimException = async (exceptionId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/reconciliation/exceptions/${exceptionId}/claim`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) throw new Error('Failed to claim exception');
      await loadExceptions();
    } catch (error) {
      logger.error('Failed to claim exception', error);
      alert('Failed to claim exception');
    }
  };

  const resolveException = async (exceptionId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/reconciliation/exceptions/${exceptionId}/resolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resolution: resolutionNotes,
        }),
      });

      if (!response.ok) throw new Error('Failed to resolve exception');
      
      setSelectedException(null);
      setResolutionNotes('');
      await loadExceptions();
    } catch (error) {
      logger.error('Failed to resolve exception', error);
      alert('Failed to resolve exception');
    }
  };

  const filteredExceptions = exceptions.filter(e => 
    filter === 'all' || e.status === filter
  );

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
          <h1 className="text-3xl font-bold text-gray-900">Exception Queue</h1>
          <p className="text-gray-600 mt-1">Items requiring manual review and resolution</p>
        </div>
        <div className="flex items-center space-x-2">
          {(['all', 'open', 'in_review', 'resolved'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                filter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1).replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Exception List */}
        <div className="lg:col-span-2 space-y-4">
          {filteredExceptions.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
              <p className="text-gray-500">No exceptions found</p>
            </div>
          ) : (
            filteredExceptions.map(exception => (
              <div
                key={exception.id}
                onClick={() => setSelectedException(exception)}
                className={`rounded-lg border p-4 cursor-pointer transition-all ${
                  selectedException?.id === exception.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <TypeBadge type={exception.type} />
                      <PriorityBadge priority={exception.priority} />
                      <StatusBadge status={exception.status} />
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1">{exception.title}</h3>
                    <p className="text-sm text-gray-600 mb-2">{exception.description}</p>
                    <p className="text-xs text-gray-500">
                      Created {new Date(exception.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {exception.status === 'open' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        claimException(exception.id);
                      }}
                      className="ml-4 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Claim
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Exception Detail */}
        <div className="lg:col-span-1">
          {selectedException ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 sticky top-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Exception Details</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <TypeBadge type={selectedException.type} />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <PriorityBadge priority={selectedException.priority} />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <StatusBadge status={selectedException.status} />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <p className="text-sm text-gray-600">{selectedException.description}</p>
                </div>

                {selectedException.documentId && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Document ID</label>
                    <a
                      href={`/documents/${selectedException.documentId}`}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      {selectedException.documentId}
                    </a>
                  </div>
                )}

                {selectedException.status !== 'resolved' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Resolution Notes
                    </label>
                    <textarea
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      rows={4}
                      className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                      placeholder="Add notes about how this exception was resolved..."
                    />
                    <button
                      onClick={() => resolveException(selectedException.id)}
                      className="mt-2 w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      Resolve Exception
                    </button>
                  </div>
                )}

                {selectedException.resolution && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Resolution</label>
                    <p className="text-sm text-gray-600">{selectedException.resolution}</p>
                    {selectedException.resolvedAt && (
                      <p className="text-xs text-gray-500 mt-1">
                        Resolved {new Date(selectedException.resolvedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
              Select an exception to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: ExceptionItem['type'] }) {
  const colors = {
    classification: 'bg-purple-100 text-purple-800',
    reconciliation: 'bg-blue-100 text-blue-800',
    ingestion: 'bg-yellow-100 text-yellow-800',
    validation: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[type]}`}>
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: ExceptionItem['priority'] }) {
  const colors = {
    low: 'bg-gray-100 text-gray-800',
    medium: 'bg-yellow-100 text-yellow-800',
    high: 'bg-orange-100 text-orange-800',
    urgent: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[priority]}`}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  );
}

function StatusBadge({ status }: { status: ExceptionItem['status'] }) {
  const colors = {
    open: 'bg-red-100 text-red-800',
    in_review: 'bg-yellow-100 text-yellow-800',
    resolved: 'bg-green-100 text-green-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
    </span>
  );
}
