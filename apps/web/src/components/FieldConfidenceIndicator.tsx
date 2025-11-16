'use client';

import React from 'react';
import ConfidenceScoreIndicator from './ConfidenceScoreIndicator';

interface FieldConfidence {
  field: string;
  label: string;
  confidence: number; // 0-1
  value: unknown;
  required: boolean;
}

interface FieldConfidenceIndicatorProps {
  fields: FieldConfidence[];
  onFieldClick?: (field: string) => void;
}

export default function FieldConfidenceIndicator({
  fields,
  onFieldClick,
}: FieldConfidenceIndicatorProps) {
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-green-600';
    if (confidence >= 0.7) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getConfidenceBg = (confidence: number) => {
    if (confidence >= 0.9) return 'bg-green-50 border-green-200';
    if (confidence >= 0.7) return 'bg-yellow-50 border-yellow-200';
    return 'bg-red-50 border-red-200';
  };

  const averageConfidence = fields.length > 0
    ? fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length
    : 0;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-4">
        <h2 className="text-2xl font-bold mb-2">Field Confidence Scores</h2>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">Overall:</span>
          <ConfidenceScoreIndicator score={averageConfidence} size="md" />
        </div>
      </div>

      <div className="space-y-3">
        {fields.map((field) => (
          <div
            key={field.field}
            className={`p-4 rounded-lg border-2 ${getConfidenceBg(field.confidence)} ${
              onFieldClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''
            }`}
            onClick={() => onFieldClick && onFieldClick(field.field)}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <label className="font-medium capitalize">{field.label || field.field}</label>
                {field.required && (
                  <span className="text-xs px-2 py-1 bg-red-100 text-red-800 rounded">
                    Required
                  </span>
                )}
              </div>
              <span className={`text-sm font-semibold ${getConfidenceColor(field.confidence)}`}>
                {(field.confidence * 100).toFixed(1)}%
              </span>
            </div>
            <ConfidenceScoreIndicator
              score={field.confidence}
              size="sm"
              showLabel={false}
              showPercentage={false}
            />
            {field.value !== undefined && field.value !== null && (
              <div className="mt-2 pt-2 border-t border-gray-200">
                <p className="text-xs text-gray-600">Value:</p>
                <p className="text-sm font-mono text-gray-800 truncate">
                  {String(field.value)}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {fields.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <p>No field confidence data available</p>
        </div>
      )}
    </div>
  );
}
