'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ClassificationReview');

interface ReviewItem {
  documentId: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  reason: string;
  confidenceScore: number;
  qualityScore: number | null;
  documentType?: string;
  vendorName?: string;
  amount?: number;
  date?: string;
  createdAt: string;
  assignedTo?: string;
  classificationResult?: {
    documentType: string;
    vendor: string;
    amount: number;
    date: string;
    lineItems?: Array<{
      description: string;
      amount: number;
      glCode?: string;
    }>;
    taxFields?: Record<string, unknown>;
  };
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface ClassificationReviewProps {
  token: string;
  tenantId: string;
}

export default function ClassificationReview({ token, tenantId: _tenantId }: ClassificationReviewProps) {
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null);
  const [corrections, setCorrections] = useState<Record<string, unknown>>({});
  const [reviewNotes, setReviewNotes] = useState('');

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadQueue = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/classification/review-queue`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load review queue');

      const data = await response.json();
      setQueue(data.queue || []);
    } catch (error) {
      logger.error('Failed to load review queue', error);
    } finally {
      setLoading(false);
    }
  };

  const assignToMe = async (documentId: string) => {
    try {
      const response = await fetch(
        `${API_BASE}/api/classification/review-queue/${documentId}/assign`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) throw new Error('Failed to assign');
      await loadQueue();
    } catch (error) {
      logger.error('Failed to assign review item', error);
      alert('Failed to assign review item');
    }
  };

  const completeReview = async (documentId: string, approved: boolean) => {
    try {
      const response = await fetch(
        `${API_BASE}/api/classification/review-queue/${documentId}/complete`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            approved,
            notes: reviewNotes,
            corrections: Object.keys(corrections).length > 0 ? corrections : undefined,
          }),
        }
      );

      if (!response.ok) throw new Error('Failed to complete review');

      setSelectedItem(null);
      setCorrections({});
      setReviewNotes('');
      await loadQueue();
    } catch (error) {
      logger.error('Failed to complete review', error);
      alert('Failed to complete review');
    }
  };

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
          <h1 className="text-3xl font-bold text-gray-900">Classification Review</h1>
          <p className="text-gray-600 mt-1">Review and correct low-confidence classifications</p>
        </div>
        <div className="text-sm text-gray-500">
          {queue.length} items in queue
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Queue List */}
        <div className="lg:col-span-2 space-y-4">
          {queue.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
              <p className="text-gray-500">No items in review queue</p>
            </div>
          ) : (
            queue.map(item => (
              <div
                key={item.documentId}
                onClick={() => setSelectedItem(item)}
                className={`rounded-lg border p-4 cursor-pointer transition-all ${
                  selectedItem?.documentId === item.documentId
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <PriorityBadge priority={item.priority} />
                      <span className="text-xs text-gray-500">
                        Confidence: {(item.confidenceScore * 100).toFixed(0)}%
                      </span>
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1">
                      {item.vendorName || 'Unknown Vendor'}
                    </h3>
                    <p className="text-sm text-gray-600 mb-2">{item.reason}</p>
                    {item.amount && (
                      <p className="text-sm font-medium text-gray-900">
                        ${item.amount.toLocaleString()}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-2">
                      {new Date(item.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {!item.assignedTo && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        assignToMe(item.documentId);
                      }}
                      className="ml-4 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Assign to Me
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Review Panel */}
        <div className="lg:col-span-1">
          {selectedItem ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 sticky top-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Review Details</h2>

              {selectedItem.classificationResult && (
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Document Type</label>
                    <input
                      type="text"
                      value={selectedItem.classificationResult.documentType}
                      onChange={(e) => setCorrections({
                        ...corrections,
                        documentType: e.target.value,
                      })}
                      className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
                    <input
                      type="text"
                      value={selectedItem.classificationResult.vendor}
                      onChange={(e) => setCorrections({
                        ...corrections,
                        vendor: e.target.value,
                      })}
                      className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                    <input
                      type="number"
                      value={selectedItem.classificationResult.amount}
                      onChange={(e) => setCorrections({
                        ...corrections,
                        amount: parseFloat(e.target.value),
                      })}
                      className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                    <input
                      type="date"
                      value={selectedItem.classificationResult.date}
                      onChange={(e) => setCorrections({
                        ...corrections,
                        date: e.target.value,
                      })}
                      className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                    />
                  </div>

                  {selectedItem.classificationResult.lineItems && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Line Items</label>
                      <div className="space-y-2">
                        {selectedItem.classificationResult.lineItems.map((lineItem, idx) => (
                          <div key={idx} className="p-2 bg-gray-50 rounded text-sm">
                            <p className="font-medium">{lineItem.description}</p>
                            <p className="text-gray-600">${lineItem.amount.toLocaleString()}</p>
                            {lineItem.glCode && (
                              <p className="text-xs text-gray-500">GL: {lineItem.glCode}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Review Notes</label>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={4}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                  placeholder="Add notes about this review..."
                />
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={() => completeReview(selectedItem.documentId, true)}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  Approve
                </button>
                <button
                  onClick={() => completeReview(selectedItem.documentId, false)}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  Reject
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
              Select an item to review
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: ReviewItem['priority'] }) {
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
