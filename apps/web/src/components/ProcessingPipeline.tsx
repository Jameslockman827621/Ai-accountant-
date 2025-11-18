'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ProcessingPipeline');

interface PipelineStage {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  error?: string;
  progress?: number; // 0-100
}

interface ProcessingPipelineProps {
  documentId: string;
  token: string;
  onComplete?: () => void;
  onError?: (error: string) => void;
}

const STAGES: Omit<PipelineStage, 'status' | 'startedAt' | 'completedAt' | 'error' | 'progress'>[] = [
  { id: 'upload', name: 'Upload' },
  { id: 'ocr', name: 'OCR Processing' },
  { id: 'classification', name: 'Classification' },
  { id: 'extraction', name: 'Field Extraction' },
  { id: 'validation', name: 'Validation' },
  { id: 'posting', name: 'Ledger Posting' },
  { id: 'complete', name: 'Complete' },
];

export default function ProcessingPipeline({
  documentId,
  token,
  onComplete,
  onError,
}: ProcessingPipelineProps) {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!documentId) return;
    
    loadPipelineStatus();
    const interval = setInterval(loadPipelineStatus, 2000); // Poll every 2s
    return () => clearInterval(interval);
  }, [documentId]);

  const loadPipelineStatus = async () => {
    try {
      const response = await fetch(`/api/documents/${documentId}/processing-status`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load pipeline status');

      const data = await response.json();
      const status = data.status || {};
      
      const pipelineStages: PipelineStage[] = STAGES.map(stage => {
        const stageStatus = status[stage.id] || {};
        return {
          ...stage,
          status: stageStatus.status || 'pending',
          startedAt: stageStatus.startedAt,
          completedAt: stageStatus.completedAt,
          error: stageStatus.error,
          progress: stageStatus.progress,
        };
      });

      setStages(pipelineStages);
      
      const completed = pipelineStages.every(s => s.status === 'completed' || s.status === 'skipped');
      const failed = pipelineStages.find(s => s.status === 'failed');
      
      if (completed && onComplete) {
        onComplete();
      }
      if (failed && onError) {
        onError(failed.error || 'Processing failed');
      }
    } catch (error) {
      logger.error('Failed to load pipeline status', error);
    } finally {
      setLoading(false);
    }
  };

  const getStageColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500 border-green-600';
      case 'processing':
        return 'bg-blue-500 border-blue-600 animate-pulse';
      case 'failed':
        return 'bg-red-500 border-red-600';
      case 'skipped':
        return 'bg-gray-400 border-gray-500';
      default:
        return 'bg-gray-300 border-gray-400';
    }
  };

  const getStageIcon = (stage: PipelineStage) => {
    switch (stage.status) {
      case 'completed':
        return '✓';
      case 'processing':
        return '⟳';
      case 'failed':
        return '✗';
      case 'skipped':
        return '⊘';
      default:
        return '○';
    }
  };

  if (loading && stages.length === 0) {
    return <div className="text-gray-500">Loading pipeline status...</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold mb-6">Processing Pipeline</h2>
      
      <div className="relative">
        {/* Connection lines */}
        <div className="absolute top-6 left-0 right-0 h-0.5 bg-gray-300" style={{ top: '24px' }} />
        
          <div className="relative flex justify-between items-start">
            {stages.map((stage) => (
            <div key={stage.id} className="flex flex-col items-center" style={{ flex: 1 }}>
              <div
                className={`relative z-10 w-12 h-12 rounded-full border-4 flex items-center justify-center text-white font-bold ${getStageColor(stage.status)}`}
              >
                {getStageIcon(stage)}
              </div>
              <div className="mt-2 text-center">
                <p className="text-sm font-medium">{stage.name}</p>
                {stage.status === 'processing' && stage.progress !== undefined && (
                  <div className="mt-1 w-24 bg-gray-200 rounded-full h-1.5">
                    <div
                      className="bg-blue-600 h-1.5 rounded-full transition-all"
                      style={{ width: `${stage.progress}%` }}
                    />
                  </div>
                )}
                {stage.status === 'failed' && stage.error && (
                  <p className="text-xs text-red-600 mt-1 max-w-24 truncate" title={stage.error}>
                    {stage.error}
                  </p>
                )}
                {stage.completedAt && (
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(stage.completedAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {stages.some(s => s.status === 'failed') && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded">
          <p className="text-sm text-red-800">
            <strong>Processing Error:</strong> One or more stages failed. Please review the errors above.
          </p>
        </div>
      )}
    </div>
  );
}
