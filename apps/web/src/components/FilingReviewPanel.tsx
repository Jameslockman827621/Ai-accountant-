'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';
import FilingDisclaimer from './FilingDisclaimer';
import AccountantReviewPrompt from './AccountantReviewPrompt';

const logger = createLogger('FilingReviewPanel');

interface FilingReviewChecklist {
  checks: Array<{
    check: string;
    passed: boolean;
    required: boolean;
    details?: string;
  }>;
  canApprove: boolean;
  canReject: boolean;
}

interface FilingComparison {
  currentFiling: {
    id: string;
    periodStart: string;
    periodEnd: string;
    data: Record<string, unknown>;
  };
  previousFiling?: {
    id: string;
    periodStart: string;
    periodEnd: string;
    data: Record<string, unknown>;
  };
  differences: Array<{
    field: string;
    currentValue: unknown;
    previousValue: unknown;
    difference: number;
    percentageChange: number;
    significance: 'low' | 'medium' | 'high';
  }>;
  warnings: string[];
}

export default function FilingReviewPanel({ filingId }: { filingId: string }) {
  const [checklist, setChecklist] = useState<FilingReviewChecklist | null>(null);
  const [comparison, setComparison] = useState<FilingComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [reviewComments, setReviewComments] = useState('');

  useEffect(() => {
    loadChecklist();
    loadComparison();
  }, [filingId]);

  const loadChecklist = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/filings/${filingId}/review/checklist`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load checklist');

      const data = await response.json();
      setChecklist(data.checklist);
    } catch (error) {
      logger.error('Failed to load checklist', error);
    }
  };

  const loadComparison = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/filings/${filingId}/compare?type=both`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load comparison');

      const data = await response.json();
      setComparison(data.comparison);
    } catch (error) {
      logger.error('Failed to load comparison', error);
    }
  };

  const approveFiling = async () => {
    setShowDisclaimer(true);
  };

  const handleDisclaimerAccept = async () => {
    setShowDisclaimer(false);
    setLoading(true);

    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/filings/${filingId}/review/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reviewId: checklist?.checks[0] ? 'review-id' : undefined,
          notes: reviewComments,
        }),
      });

      if (!response.ok) throw new Error('Failed to approve filing');

      alert('Filing approved successfully');
      window.location.reload();
    } catch (error) {
      logger.error('Failed to approve filing', error);
      alert('Failed to approve filing');
    } finally {
      setLoading(false);
    }
  };

  const rejectFiling = async () => {
    const reason = prompt('Please provide a reason for rejection:');
    if (!reason) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/filings/${filingId}/review/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reviewId: 'review-id',
          reason,
        }),
      });

      if (!response.ok) throw new Error('Failed to reject filing');

      alert('Filing rejected');
      window.location.reload();
    } catch (error) {
      logger.error('Failed to reject filing', error);
      alert('Failed to reject filing');
    } finally {
      setLoading(false);
    }
  };

  const filingData = comparison?.currentFiling.data || {};
  const totalAmount = typeof filingData.total === 'number' ? filingData.total : 0;

  return (
    <div className="space-y-6">
      {showDisclaimer && (
        <FilingDisclaimer
          onAccept={handleDisclaimerAccept}
          onCancel={() => setShowDisclaimer(false)}
        />
      )}

      <AccountantReviewPrompt
        filingType={filingData.filing_type as string || 'vat'}
        amount={totalAmount}
        onRequestReview={() => alert('Accountant review requested')}
        onProceed={() => approveFiling()}
      />

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">Filing Review</h2>

        {checklist && (
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-3">Review Checklist</h3>
            <div className="space-y-2">
              {checklist.checks.map((check, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 p-2 rounded ${
                    check.passed ? 'bg-green-50' : check.required ? 'bg-red-50' : 'bg-yellow-50'
                  }`}
                >
                  <span>{check.passed ? '✅' : check.required ? '❌' : '⚠️'}</span>
                  <span className="flex-1">{check.check}</span>
                  {check.details && (
                    <span className="text-sm text-gray-600">{check.details}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {comparison && comparison.differences.length > 0 && (
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-3">Comparison with Previous Period</h3>
            <div className="space-y-2">
              {comparison.differences.map((diff, i) => (
                <div
                  key={i}
                  className={`p-2 rounded ${
                    diff.significance === 'high' ? 'bg-red-50' :
                    diff.significance === 'medium' ? 'bg-yellow-50' :
                    'bg-green-50'
                  }`}
                >
                  <p className="font-medium">{diff.field}</p>
                  <p className="text-sm text-gray-600">
                    Current: {String(diff.currentValue)} | Previous: {String(diff.previousValue)}
                  </p>
                  <p className="text-sm text-gray-600">
                    Change: {diff.percentageChange > 0 ? '+' : ''}{diff.percentageChange.toFixed(1)}%
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {comparison && comparison.warnings.length > 0 && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
            <h3 className="font-semibold mb-2">Warnings</h3>
            <ul className="list-disc pl-6">
              {comparison.warnings.map((warn, i) => (
                <li key={i} className="text-sm">{warn}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Review Comments
          </label>
          <textarea
            value={reviewComments}
            onChange={(e) => setReviewComments(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
            rows={4}
            placeholder="Add your review comments..."
          />
        </div>

        <div className="flex gap-4">
          <button
            onClick={approveFiling}
            disabled={loading || !checklist?.canApprove}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            Approve Filing
          </button>
          <button
            onClick={rejectFiling}
            disabled={loading || !checklist?.canReject}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            Reject Filing
          </button>
        </div>
      </div>
    </div>
  );
}
