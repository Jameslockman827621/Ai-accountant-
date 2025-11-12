import React, { useState } from 'react';

interface ErrorRecoveryProps {
  error: {
    type: string;
    message: string;
    entityId?: string;
    entityType?: string;
    retryable?: boolean;
  };
  onRetry: () => void;
  onDismiss: () => void;
  onManualFix?: () => void;
}

export default function ErrorRecovery({ error, onRetry, onDismiss, onManualFix }: ErrorRecoveryProps) {
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-4">
      <div className="flex">
        <div className="flex-shrink-0">
          <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-red-800">
            {error.type === 'processing' ? 'Processing Error' : 
             error.type === 'validation' ? 'Validation Error' :
             error.type === 'network' ? 'Network Error' : 'Error'}
          </h3>
          <div className="mt-2 text-sm text-red-700">
            <p>{error.message}</p>
            {error.entityId && (
              <p className="mt-1 text-xs">
                Entity: {error.entityType} ({error.entityId})
              </p>
            )}
          </div>
          <div className="mt-4 flex space-x-2">
            {error.retryable && (
              <button
                onClick={handleRetry}
                disabled={isRetrying}
                className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
              >
                {isRetrying ? 'Retrying...' : 'Retry'}
              </button>
            )}
            {onManualFix && (
              <button
                onClick={onManualFix}
                className="px-3 py-1 bg-white text-red-600 text-sm border border-red-300 rounded hover:bg-red-50"
              >
                Fix Manually
              </button>
            )}
            <button
              onClick={onDismiss}
              className="px-3 py-1 bg-white text-gray-600 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
