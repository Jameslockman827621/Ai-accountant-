'use client';

import React from 'react';

interface ConfidenceScoreIndicatorProps {
  score: number; // 0-1
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  showPercentage?: boolean;
}

export default function ConfidenceScoreIndicator({
  score,
  size = 'md',
  showLabel = true,
  showPercentage = true,
}: ConfidenceScoreIndicatorProps) {
  const percentage = Math.round(score * 100);
  const color = score >= 0.9 ? 'green' : score >= 0.7 ? 'yellow' : 'red';
  
  const sizeClasses = {
    sm: 'h-2',
    md: 'h-3',
    lg: 'h-4',
  };

  const bgColors = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
  };

  const textColors = {
    green: 'text-green-600',
    yellow: 'text-yellow-600',
    red: 'text-red-600',
  };

  return (
    <div className="flex items-center gap-2">
      {showLabel && (
        <span className="text-sm text-gray-600">Confidence:</span>
      )}
      <div className="flex-1 bg-gray-200 rounded-full overflow-hidden" style={{ width: size === 'sm' ? '60px' : size === 'md' ? '100px' : '150px' }}>
        <div
          className={`${sizeClasses[size]} ${bgColors[color]} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showPercentage && (
        <span className={`text-sm font-medium ${textColors[color]}`}>
          {percentage}%
        </span>
      )}
    </div>
  );
}
