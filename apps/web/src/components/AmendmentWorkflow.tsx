'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('AmendmentWorkflow');

interface Amendment {
  id: string;
  originalFilingId: string;
  reason: string;
  changes: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }>;
  status: 'draft' | 'submitted' | 'accepted' | 'rejected';
  submittedAt?: string;
  createdAt: string;
}

interface AmendmentWorkflowProps {
  filingId: string;
  token: string;
  onAmendmentSubmit?: (amendmentId: string) => void;
}

export default function AmendmentWorkflow({
  filingId,
  token,
  onAmendmentSubmit,
}: AmendmentWorkflowProps) {
  const [amendments, setAmendments] = useState<Amendment[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    reason: '',
    changes: [] as Array<{ field: string; oldValue: string; newValue: string }>,
  });

  useEffect(() => {
    loadAmendments();
  }, [filingId]);

  const loadAmendments = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/filings/${filingId}/amendments`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load amendments');

      const data = await response.json();
      setAmendments(data.amendments || []);
    } catch (error) {
      logger.error('Failed to load amendments', error);
    } finally {
      setLoading(false);
    }
  };

  const createAmendment = async () => {
    if (!formData.reason.trim()) {
      alert('Please provide a reason for the amendment');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/filings/${filingId}/amendments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reason: formData.reason,
          changes: formData.changes,
        }),
      });

      if (!response.ok) throw new Error('Failed to create amendment');

      await loadAmendments();
      setShowCreateForm(false);
      setFormData({ reason: '', changes: [] });
    } catch (error) {
      logger.error('Failed to create amendment', error);
      alert('Failed to create amendment');
    } finally {
      setLoading(false);
    }
  };

  const submitAmendment = async (amendmentId: string) => {
    if (!confirm('Are you sure you want to submit this amendment to HMRC?')) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/filings/amendments/${amendmentId}/submit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to submit amendment');

      if (onAmendmentSubmit) {
        onAmendmentSubmit(amendmentId);
      }
      await loadAmendments();
    } catch (error) {
      logger.error('Failed to submit amendment', error);
      alert('Failed to submit amendment');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'submitted':
        return 'bg-blue-100 border-blue-200 text-blue-800';
      case 'accepted':
        return 'bg-green-100 border-green-200 text-green-800';
      case 'rejected':
        return 'bg-red-100 border-red-200 text-red-800';
      default:
        return 'bg-gray-100 border-gray-200 text-gray-800';
    }
  };

  const addChange = () => {
    setFormData({
      ...formData,
      changes: [...formData.changes, { field: '', oldValue: '', newValue: '' }],
    });
  };

  const updateChange = (index: number, field: string, value: string) => {
    const newChanges = [...formData.changes];
    newChanges[index] = { ...newChanges[index], [field]: value };
    setFormData({ ...formData, changes: newChanges });
  };

  const removeChange = (index: number) => {
    setFormData({
      ...formData,
      changes: formData.changes.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Amendment Workflow</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {showCreateForm ? 'Cancel' : 'Create Amendment'}
        </button>
      </div>

      {showCreateForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="font-semibold mb-3">Create New Amendment</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason for Amendment *
              </label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                rows={3}
                placeholder="Explain why this amendment is necessary..."
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Changes
                </label>
                <button
                  onClick={addChange}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  + Add Change
                </button>
              </div>
              {formData.changes.map((change, index) => (
                <div key={index} className="mb-3 p-3 bg-white rounded border border-gray-200">
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <input
                      type="text"
                      value={change.field}
                      onChange={(e) => updateChange(index, 'field', e.target.value)}
                      placeholder="Field name"
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                    <input
                      type="text"
                      value={change.oldValue}
                      onChange={(e) => updateChange(index, 'oldValue', e.target.value)}
                      placeholder="Old value"
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={change.newValue}
                        onChange={(e) => updateChange(index, 'newValue', e.target.value)}
                        placeholder="New value"
                        className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                      <button
                        onClick={() => removeChange(index)}
                        className="px-2 py-1 text-red-600 hover:text-red-800"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={createAmendment}
              disabled={loading || !formData.reason.trim()}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Amendment'}
            </button>
          </div>
        </div>
      )}

      {loading && amendments.length === 0 ? (
        <div className="text-center py-8 text-gray-500">Loading amendments...</div>
      ) : amendments.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No amendments for this filing</p>
        </div>
      ) : (
        <div className="space-y-4">
          {amendments.map((amendment) => (
            <div
              key={amendment.id}
              className={`p-4 rounded-lg border-2 ${getStatusColor(amendment.status)}`}
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-semibold">Amendment #{amendment.id.slice(0, 8)}</h3>
                  <p className="text-sm text-gray-600 mt-1">{amendment.reason}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${
                  amendment.status === 'accepted' ? 'bg-green-200 text-green-900' :
                  amendment.status === 'rejected' ? 'bg-red-200 text-red-900' :
                  amendment.status === 'submitted' ? 'bg-blue-200 text-blue-900' :
                  'bg-gray-200 text-gray-900'
                }`}>
                  {amendment.status.toUpperCase()}
                </span>
              </div>

              {amendment.changes.length > 0 && (
                <div className="mb-3">
                  <p className="text-sm font-medium mb-2">Changes:</p>
                  <div className="space-y-2">
                    {amendment.changes.map((change, index) => (
                      <div key={index} className="bg-white p-2 rounded text-sm">
                        <span className="font-medium">{change.field}:</span>{' '}
                        <span className="text-red-600 line-through">{String(change.oldValue)}</span>
                        {' → '}
                        <span className="text-green-600 font-semibold">{String(change.newValue)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center">
                <p className="text-xs text-gray-600">
                  Created: {new Date(amendment.createdAt).toLocaleString()}
                  {amendment.submittedAt && (
                    <> • Submitted: {new Date(amendment.submittedAt).toLocaleString()}</>
                  )}
                </p>
                {amendment.status === 'draft' && (
                  <button
                    onClick={() => submitAmendment(amendment.id)}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Submit to HMRC
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
