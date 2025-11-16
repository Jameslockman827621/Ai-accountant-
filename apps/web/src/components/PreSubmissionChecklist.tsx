'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('PreSubmissionChecklist');

interface ChecklistItem {
  id: string;
  check: string;
  passed: boolean;
  required: boolean;
  details?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface PreSubmissionChecklistProps {
  filingId: string;
  onAllChecksPassed?: () => void;
  onCheckFailed?: () => void;
}

export default function PreSubmissionChecklist({
  filingId,
  onAllChecksPassed,
  onCheckFailed,
}: PreSubmissionChecklistProps) {
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);

  useEffect(() => {
    loadChecklist();
  }, [filingId]);

  const loadChecklist = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/filings/${filingId}/review/checklist`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load checklist');

      const data = await response.json();
      const items: ChecklistItem[] = (data.checklist?.checks || []).map((check: any, i: number) => ({
        id: `check-${i}`,
        check: check.check,
        passed: check.passed,
        required: check.required,
        details: check.details,
      }));

      setChecklist(items);
      setCanSubmit(data.checklist?.canApprove || false);

      if (data.checklist?.canApprove && onAllChecksPassed) {
        onAllChecksPassed();
      } else if (!data.checklist?.canApprove && onCheckFailed) {
        onCheckFailed();
      }
    } catch (error) {
      logger.error('Failed to load checklist', error);
    } finally {
      setLoading(false);
    }
  };

  const runPreSubmissionValidation = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/validation/pre-submission`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ filingId }),
      });

      if (!response.ok) throw new Error('Validation failed');

      const data = await response.json();
      await loadChecklist(); // Reload to get updated status
    } catch (error) {
      logger.error('Pre-submission validation failed', error);
      alert('Failed to run pre-submission validation');
    } finally {
      setLoading(false);
    }
  };

  if (loading && checklist.length === 0) {
    return <div className="text-gray-500">Loading checklist...</div>;
  }

  const requiredChecks = checklist.filter(c => c.required);
  const passedRequired = requiredChecks.every(c => c.passed);
  const allPassed = checklist.every(c => c.passed);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Pre-Submission Checklist</h2>
        <button
          onClick={runPreSubmissionValidation}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Re-validate
        </button>
      </div>

      <div className="mb-4">
        <div className={`p-4 rounded ${
          allPassed ? 'bg-green-50 border border-green-200' :
          passedRequired ? 'bg-yellow-50 border border-yellow-200' :
          'bg-red-50 border border-red-200'
        }`}>
          <p className="font-semibold">
            {allPassed ? '✅ All checks passed - Ready to submit' :
             passedRequired ? '⚠️ Some optional checks failed' :
             '❌ Required checks failed - Cannot submit'}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {checklist.map((item) => (
          <div
            key={item.id}
            className={`flex items-start gap-3 p-3 rounded border ${
              item.passed
                ? 'bg-green-50 border-green-200'
                : item.required
                ? 'bg-red-50 border-red-200'
                : 'bg-yellow-50 border-yellow-200'
            }`}
          >
            <div className="flex-shrink-0 mt-1">
              {item.passed ? (
                <span className="text-green-600 text-xl">✅</span>
              ) : item.required ? (
                <span className="text-red-600 text-xl">❌</span>
              ) : (
                <span className="text-yellow-600 text-xl">⚠️</span>
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium">{item.check}</p>
                {item.required && (
                  <span className="text-xs px-2 py-1 bg-red-100 text-red-800 rounded">Required</span>
                )}
              </div>
              {item.details && (
                <p className="text-sm text-gray-600 mt-1">{item.details}</p>
              )}
            </div>
            {item.action && (
              <button
                onClick={item.action.onClick}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {item.action.label}
              </button>
            )}
          </div>
        ))}
      </div>

      {!canSubmit && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded">
          <p className="text-sm text-red-800">
            <strong>Cannot submit:</strong> Please resolve all required checks before submitting this filing.
          </p>
        </div>
      )}
    </div>
  );
}
