'use client';

import React, { useState } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('CancelSubscription');

interface CancelSubscriptionProps {
  token: string;
  subscriptionId: string;
  currentTier: string;
  cancelAtPeriodEnd: boolean;
  periodEnd: string;
  onCancelled?: () => void;
  onReinstated?: () => void;
}

export default function CancelSubscription({
  token,
  subscriptionId,
  currentTier,
  cancelAtPeriodEnd,
  periodEnd,
  onCancelled,
  onReinstated,
}: CancelSubscriptionProps) {
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');

  const cancelSubscription = async () => {
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/billing/subscription/${subscriptionId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reason,
          feedback,
        }),
      });

      if (!response.ok) throw new Error('Failed to cancel subscription');

      if (onCancelled) {
        onCancelled();
      }
      alert('Subscription will be cancelled at the end of your billing period. You will continue to have access until then.');
    } catch (error) {
      logger.error('Failed to cancel subscription', error);
      alert('Failed to cancel subscription. Please try again or contact support.');
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  };

  const reinstateSubscription = async () => {
    if (!confirm('Are you sure you want to reinstate your subscription?')) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/billing/subscription/${subscriptionId}/reinstate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to reinstate subscription');

      if (onReinstated) {
        onReinstated();
      }
      alert('Subscription reinstated successfully!');
    } catch (error) {
      logger.error('Failed to reinstate subscription', error);
      alert('Failed to reinstate subscription. Please try again or contact support.');
    } finally {
      setLoading(false);
    }
  };

  if (cancelAtPeriodEnd) {
    return (
      <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-6">
        <h3 className="text-xl font-bold text-yellow-900 mb-2">⚠️ Subscription Scheduled for Cancellation</h3>
        <p className="text-yellow-800 mb-4">
          Your subscription will be cancelled on {new Date(periodEnd).toLocaleDateString()}.
          You will continue to have access to all features until then.
        </p>
        <button
          onClick={reinstateSubscription}
          disabled={loading}
          className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? 'Reinstating...' : 'Reinstate Subscription'}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 border-2 border-red-200">
      <h3 className="text-xl font-bold text-red-900 mb-2">Cancel Subscription</h3>
      <p className="text-gray-700 mb-4">
        We're sorry to see you go. Your subscription will remain active until the end of your current billing period ({new Date(periodEnd).toLocaleDateString()}).
      </p>

      {!showConfirm ? (
        <button
          onClick={() => setShowConfirm(true)}
          className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          Cancel Subscription
        </button>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason for cancellation (optional)
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">Select a reason...</option>
              <option value="too_expensive">Too expensive</option>
              <option value="missing_features">Missing features</option>
              <option value="not_using">Not using the service</option>
              <option value="switching">Switching to another service</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Additional feedback (optional)
            </label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              rows={3}
              placeholder="Help us improve by sharing your feedback..."
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={cancelSubscription}
              disabled={loading}
              className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? 'Cancelling...' : 'Confirm Cancellation'}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Keep Subscription
            </button>
          </div>

          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-900">
              <strong>💡 Before you go:</strong> Consider pausing your subscription or switching to a lower tier instead.
              Contact support if you'd like to discuss options.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
