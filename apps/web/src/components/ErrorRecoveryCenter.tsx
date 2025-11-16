'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ErrorRecoveryCenter');

interface ErrorRecord {
  id: string;
  errorType: string;
  message: string;
  userFriendlyMessage: string;
  operationType: string;
  operationId: string;
  status: 'pending' | 'retrying' | 'succeeded' | 'failed';
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: string;
  createdAt: string;
}

export default function ErrorRecoveryCenter() {
  const [errors, setErrors] = useState<ErrorRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedError, setSelectedError] = useState<ErrorRecord | null>(null);

  useEffect(() => {
    loadErrors();
  }, []);

  const loadErrors = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/errors', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load errors');

      const data = await response.json();
      setErrors(data.errors || []);
    } catch (error) {
      logger.error('Failed to load errors', error);
    } finally {
      setLoading(false);
    }
  };

  const translateError = async (error: ErrorRecord) => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/errors/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          error: error.message,
          errorType: error.errorType,
        }),
      });

      if (!response.ok) throw new Error('Failed to translate error');

      const data = await response.json();
      setErrors(errors.map(e => e.id === error.id ? { ...e, userFriendlyMessage: data.message } : e));
    } catch (error) {
      logger.error('Failed to translate error', error);
    }
  };

  const retryError = async (errorId: string) => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/errors/${errorId}/retry`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to retry');

      await loadErrors();
      alert('Retry scheduled successfully');
    } catch (error) {
      logger.error('Failed to retry error', error);
      alert('Failed to schedule retry');
    }
  };

  const resolveError = async (errorId: string) => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/errors/${errorId}/resolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to resolve');

      await loadErrors();
      alert('Error resolved');
    } catch (error) {
      logger.error('Failed to resolve error', error);
      alert('Failed to resolve error');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'succeeded':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'retrying':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Error Recovery Center</h2>
          <button
            onClick={loadErrors}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {loading && <p className="text-gray-500">Loading...</p>}

        {!loading && errors.length === 0 && (
          <p className="text-gray-500">No errors to display</p>
        )}

        {!loading && errors.length > 0 && (
          <div className="space-y-4">
            {errors.map((error) => (
              <div
                key={error.id}
                className="border rounded-lg p-4 hover:bg-gray-50"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(error.status)}`}>
                        {error.status.toUpperCase()}
                      </span>
                      <span className="text-sm text-gray-600">
                        {error.operationType} ({error.retryCount}/{error.maxRetries} retries)
                      </span>
                    </div>
                    <p className="font-medium mb-1">
                      {error.userFriendlyMessage || error.message}
                    </p>
                    {!error.userFriendlyMessage && (
                      <p className="text-sm text-gray-600 mb-1">
                        Technical: {error.message}
                      </p>
                    )}
                    <p className="text-xs text-gray-500">
                      {new Date(error.createdAt).toLocaleString()}
                      {error.nextRetryAt && (
                        <> | Next retry: {new Date(error.nextRetryAt).toLocaleString()}</>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {!error.userFriendlyMessage && (
                      <button
                        onClick={() => translateError(error)}
                        className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
                      >
                        Translate
                      </button>
                    )}
                    {error.status === 'pending' && (
                      <button
                        onClick={() => retryError(error.id)}
                        className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Retry
                      </button>
                    )}
                    <button
                      onClick={() => resolveError(error.id)}
                      className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      Resolve
                    </button>
                    <button
                      onClick={() => setSelectedError(error)}
                      className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
                    >
                      Details
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedError && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4">
              <h3 className="text-xl font-bold mb-4">Error Details</h3>
              <div className="space-y-2 mb-4">
                <p><strong>Type:</strong> {selectedError.errorType}</p>
                <p><strong>Operation:</strong> {selectedError.operationType}</p>
                <p><strong>Status:</strong> {selectedError.status}</p>
                <p><strong>Retries:</strong> {selectedError.retryCount} / {selectedError.maxRetries}</p>
                <p><strong>Message:</strong> {selectedError.userFriendlyMessage || selectedError.message}</p>
              </div>
              <button
                onClick={() => setSelectedError(null)}
                className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
