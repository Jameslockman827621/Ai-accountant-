'use client';

import React from 'react';

interface ComplianceWarningProps {
  type: 'complex_tax' | 'high_value' | 'multi_jurisdiction' | 'unusual_pattern';
  message: string;
  onAcknowledge?: () => void;
  onDismiss?: () => void;
}

export default function ComplianceWarning({
  type,
  message,
  onAcknowledge,
  onDismiss,
}: ComplianceWarningProps) {
  const getIcon = () => {
    switch (type) {
      case 'complex_tax':
        return '⚠️';
      case 'high_value':
        return '💰';
      case 'multi_jurisdiction':
        return '🌍';
      case 'unusual_pattern':
        return '🔍';
      default:
        return '⚠️';
    }
  };

  const getColor = () => {
    switch (type) {
      case 'complex_tax':
        return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      case 'high_value':
        return 'bg-orange-50 border-orange-200 text-orange-800';
      case 'multi_jurisdiction':
        return 'bg-blue-50 border-blue-200 text-blue-800';
      case 'unusual_pattern':
        return 'bg-red-50 border-red-200 text-red-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  return (
    <div className={`border-l-4 p-4 mb-4 ${getColor()}`}>
      <div className="flex items-start">
        <span className="text-2xl mr-3">{getIcon()}</span>
        <div className="flex-1">
          <h3 className="font-semibold mb-1">Compliance Warning</h3>
          <p className="text-sm">{message}</p>
          <div className="mt-3 flex gap-2">
            {onAcknowledge && (
              <button
                onClick={onAcknowledge}
                className="px-3 py-1 text-xs font-medium bg-white border border-current rounded hover:bg-opacity-10"
              >
                Acknowledge
              </button>
            )}
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="px-3 py-1 text-xs font-medium bg-white border border-current rounded hover:bg-opacity-10"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
