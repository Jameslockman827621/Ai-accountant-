'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ReviewQueue');

interface ReviewQueueItem {
  documentId: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  reason: string;
  confidenceScore: number;
  qualityScore: number | null;
  createdAt: string;
  assignedTo?: string;
}

export default function ReviewQueue() {
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');

  useEffect(() => {
    loadQueue();
  }, []);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/classification/review-queue', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load queue');

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
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/classification/review-queue/${documentId}/assign`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to assign');

      await loadQueue();
    } catch (error) {
      logger.error('Failed to assign item', error);
      alert('Failed to assign item');
    }
  };

  const completeReview = async (documentId: string, approved: boolean) => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/classification/review-queue/${documentId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          approved,
          notes: reviewNotes,
        }),
      });

      if (!response.ok) throw new Error('Failed to complete review');

      setSelectedItem(null);
      setReviewNotes('');
      await loadQueue();
    } catch (error) {
      logger.error('Failed to complete review', error);
      alert('Failed to complete review');
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-red-800';
      case 'high':
        return 'bg-orange-100 text-orange-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Document Review Queue</h2>
          <button
            onClick={loadQueue}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {loading && <p className="text-gray-500">Loading...</p>}

        {!loading && queue.length === 0 && (
          <p className="text-gray-500">No items in review queue</p>
        )}

        {!loading && queue.length > 0 && (
          <div className="space-y-4">
            {queue.map((item) => (
              <div
                key={item.documentId}
                className="border rounded-lg p-4 hover:bg-gray-50"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getPriorityColor(item.priority)}`}>
                        {item.priority.toUpperCase()}
                      </span>
                      <span className="text-sm text-gray-600">
                        Confidence: {(item.confidenceScore * 100).toFixed(1)}%
                      </span>
                      {item.qualityScore && (
                        <span className="text-sm text-gray-600">
                          Quality: {item.qualityScore}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 mb-1">{item.reason}</p>
                    <p className="text-xs text-gray-500">
                      Document ID: {item.documentId.substring(0, 8)}...
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {!item.assignedTo && (
                      <button
                        onClick={() => assignToMe(item.documentId)}
                        className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Assign to Me
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedItem(item.documentId)}
                      className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
                    >
                      Review
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedItem && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4">
              <h3 className="text-xl font-bold mb-4">Review Document</h3>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Add review notes..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md mb-4"
                rows={4}
              />
              <div className="flex gap-4">
                <button
                  onClick={() => completeReview(selectedItem, true)}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Approve
                </button>
                <button
                  onClick={() => completeReview(selectedItem, false)}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Reject
                </button>
                <button
                  onClick={() => {
                    setSelectedItem(null);
                    setReviewNotes('');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
