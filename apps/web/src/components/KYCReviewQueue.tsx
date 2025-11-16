'use client';

import { useCallback, useEffect, useState } from 'react';

interface KYCReview {
  id: string;
  tenantId: string;
  userId: string;
  verificationType: string;
  provider: string;
  status: string;
  requiresManualReview: boolean;
  providerScore: number | null;
  providerReason: string | null;
  createdAt: Date;
}

interface KYCReviewQueueProps {
  token: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function KYCReviewQueue({ token }: KYCReviewQueueProps) {
  const [reviews, setReviews] = useState<KYCReview[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedReview, setSelectedReview] = useState<KYCReview | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchReviews = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/kyc/reviews`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load reviews');
      }

      const data = await response.json();
      setReviews(data.reviews || []);
    } catch (err) {
      console.error('Failed to fetch reviews', err);
      setError('Unable to load review queue');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const handleReview = useCallback(
    async (reviewId: string, approved: boolean) => {
      setIsSubmitting(true);
      try {
        const response = await fetch(`${API_BASE}/api/kyc/reviews/${reviewId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            approved,
            reviewNotes: reviewNotes || undefined,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to submit review');
        }

        setSelectedReview(null);
        setReviewNotes('');
        await fetchReviews();
      } catch (err) {
        console.error('Failed to submit review', err);
        alert('Failed to submit review. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [token, reviewNotes, fetchReviews]
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      case 'requires_review':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">KYC Review Queue</h3>
          <p className="text-sm text-gray-500">
            Review and approve pending identity verifications.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchReviews}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading reviews…</p>
      ) : reviews.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
          No pending reviews at this time.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Verification ID</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reviews.map(review => (
                <tr key={review.id} className="text-gray-700">
                  <td className="px-3 py-3 font-mono text-xs">{review.id.slice(0, 8)}…</td>
                  <td className="px-3 py-3 capitalize">{review.verificationType}</td>
                  <td className="px-3 py-3 capitalize">{review.provider}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${getStatusColor(review.status)}`}>
                      {review.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {review.providerScore !== null ? (
                      <span className="font-medium">{Math.round(review.providerScore * 100)}%</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {new Date(review.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setSelectedReview(review)}
                      className="rounded border border-blue-300 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Review Modal */}
      {selectedReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl p-6 space-y-4">
            <button
              type="button"
              onClick={() => {
                setSelectedReview(null);
                setReviewNotes('');
              }}
              className="absolute right-4 top-4 rounded-full border border-gray-200 p-1 text-gray-500 hover:text-gray-700"
            >
              ×
            </button>

            <h3 className="text-xl font-semibold text-gray-900">Review Verification</h3>

            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-700">Verification ID</p>
                <p className="text-sm text-gray-600 font-mono">{selectedReview.id}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">Type</p>
                <p className="text-sm text-gray-600 capitalize">{selectedReview.verificationType}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">Provider</p>
                <p className="text-sm text-gray-600 capitalize">{selectedReview.provider}</p>
              </div>
              {selectedReview.providerScore !== null && (
                <div>
                  <p className="text-sm font-medium text-gray-700">Provider Score</p>
                  <p className="text-sm text-gray-600">{Math.round(selectedReview.providerScore * 100)}%</p>
                </div>
              )}
              {selectedReview.providerReason && (
                <div>
                  <p className="text-sm font-medium text-gray-700">Provider Reason</p>
                  <p className="text-sm text-gray-600">{selectedReview.providerReason}</p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Review Notes
              </label>
              <textarea
                value={reviewNotes}
                onChange={e => setReviewNotes(e.target.value)}
                rows={4}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Add notes about your review decision..."
              />
            </div>

            <div className="flex space-x-3 pt-4 border-t">
              <button
                type="button"
                onClick={() => handleReview(selectedReview.id, true)}
                disabled={isSubmitting}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
              >
                {isSubmitting ? 'Submitting…' : 'Approve'}
              </button>
              <button
                type="button"
                onClick={() => handleReview(selectedReview.id, false)}
                disabled={isSubmitting}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isSubmitting ? 'Submitting…' : 'Reject'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedReview(null);
                  setReviewNotes('');
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
