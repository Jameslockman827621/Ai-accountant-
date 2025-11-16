'use client';

import React, { useState } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('BulkOperationsPanel');

interface BulkOperation {
  id: string;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
  totalItems: number;
  processedItems: number;
  successfulItems: number;
  failedItems: number;
  progress: number;
}

interface BulkOperationsPanelProps {
  token: string;
}

export default function BulkOperationsPanel({ token }: BulkOperationsPanelProps) {
  const [operations, setOperations] = useState<BulkOperation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedType, setSelectedType] = useState<'document_processing' | 'categorization' | 'ledger_posting' | 'filing_creation'>('document_processing');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);

  const loadOperations = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/bulk-operations', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load operations');

      const data = await response.json();
      setOperations(data.operations || []);
    } catch (error) {
      logger.error('Failed to load operations', error);
    } finally {
      setLoading(false);
    }
  };

  const startBulkOperation = async () => {
    if (selectedItems.length === 0) {
      alert('Please select items to process');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/bulk-operations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: selectedType,
          itemIds: selectedItems,
        }),
      });

      if (!response.ok) throw new Error('Failed to start operation');

      const data = await response.json();
      await loadOperations();
      setShowForm(false);
      setSelectedItems([]);
    } catch (error) {
      logger.error('Failed to start operation', error);
      alert('Failed to start bulk operation');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'processing':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'partial':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Bulk Operations</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          New Operation
        </button>
      </div>

      {showForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="font-semibold mb-3">Create Bulk Operation</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Operation Type
              </label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="document_processing">Document Processing</option>
                <option value="categorization">Categorization</option>
                <option value="ledger_posting">Ledger Posting</option>
                <option value="filing_creation">Filing Creation</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Selected Items ({selectedItems.length})
              </label>
              <input
                type="text"
                placeholder="Enter item IDs (comma-separated)"
                value={selectedItems.join(', ')}
                onChange={(e) => setSelectedItems(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={startBulkOperation}
                disabled={loading || selectedItems.length === 0}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Starting...' : 'Start Operation'}
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  setSelectedItems([]);
                }}
                className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {loading && operations.length === 0 ? (
          <div className="text-center py-8 text-gray-500">Loading operations...</div>
        ) : operations.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No bulk operations</div>
        ) : (
          operations.map((op) => (
            <div
              key={op.id}
              className="p-4 rounded-lg border-2 border-gray-200"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-semibold capitalize">{op.type.replace(/_/g, ' ')}</h3>
                  <p className="text-sm text-gray-600">Operation ID: {op.id.slice(0, 8)}...</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${getStatusColor(op.status)}`}>
                  {op.status.toUpperCase()}
                </span>
              </div>

              <div className="mb-3">
                <div className="flex justify-between text-sm mb-1">
                  <span>Progress</span>
                  <span>{op.processedItems} / {op.totalItems}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{ width: `${op.progress}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-gray-600">Total:</span>
                  <span className="ml-2 font-medium">{op.totalItems}</span>
                </div>
                <div>
                  <span className="text-green-600">Success:</span>
                  <span className="ml-2 font-medium">{op.successfulItems}</span>
                </div>
                <div>
                  <span className="text-red-600">Failed:</span>
                  <span className="ml-2 font-medium">{op.failedItems}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
