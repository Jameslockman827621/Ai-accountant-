'use client';

import React, { useState, useEffect } from 'react';
import {
  DocumentTextIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

interface Document {
  id: string;
  fileName: string;
  extractedFields: Record<string, { value: unknown; confidence: number }>;
  suggestedLedgerPosting?: {
    accountCode: string;
    accountName: string;
    amount: number;
    entryType: 'debit' | 'credit';
  };
  confidenceScore: number;
  vendorName?: string;
  category?: string;
}

interface GoldenDatasetReviewerProps {
  tenantId: string;
  sampleId?: string;
}

export default function GoldenDatasetReviewer({
  tenantId,
  sampleId,
}: GoldenDatasetReviewerProps) {
  const [document, setDocument] = useState<Document | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [fieldCorrections, setFieldCorrections] = useState<Record<string, unknown>>({});
  const [isAnomaly, setIsAnomaly] = useState(false);
  const [anomalyReason, setAnomalyReason] = useState('');
  const [expectedLedgerPosting, setExpectedLedgerPosting] = useState<Document['suggestedLedgerPosting'] | null>(null);

  useEffect(() => {
    if (sampleId) {
      loadSample(sampleId);
    } else {
      loadNextSample();
    }
  }, [sampleId]);

  const loadSample = async (id: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/golden-dataset/samples/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load sample');

      const data = await response.json();
      setDocument(data.document);
      setFieldCorrections({});
      setIsAnomaly(false);
      setAnomalyReason('');
      setExpectedLedgerPosting(data.document.suggestedLedgerPosting || null);
    } catch (error) {
      console.error('Failed to load sample', error);
    } finally {
      setLoading(false);
    }
  };

  const loadNextSample = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/golden-dataset/samples/next', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load next sample');

      const data = await response.json();
      if (data.sample) {
        setDocument(data.sample.document);
        setFieldCorrections({});
        setIsAnomaly(false);
        setAnomalyReason('');
        setExpectedLedgerPosting(data.sample.document.suggestedLedgerPosting || null);
      }
    } catch (error) {
      console.error('Failed to load next sample', error);
    } finally {
      setLoading(false);
    }
  };

  const saveLabel = async () => {
    if (!document) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/golden-dataset/labels', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentId: document.id,
          labels: Object.entries(fieldCorrections).map(([fieldName, correctedValue]) => ({
            labelType: 'field_validation',
            fieldName,
            originalValue: document.extractedFields[fieldName]?.value,
            correctedValue,
          })),
          isAnomaly,
          anomalyReason: isAnomaly ? anomalyReason : undefined,
          expectedLedgerPosting: expectedLedgerPosting || undefined,
        }),
      });

      if (!response.ok) throw new Error('Failed to save label');

      // Load next sample
      await loadNextSample();
    } catch (error) {
      console.error('Failed to save label', error);
    } finally {
      setLoading(false);
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-green-600 bg-green-50';
    if (confidence >= 0.7) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const getConfidenceHeatmap = (confidence: number) => {
    const intensity = Math.round(confidence * 100);
    return {
      backgroundColor: `rgba(59, 130, 246, ${confidence})`,
      opacity: confidence,
    };
  };

  if (loading && !document) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!document) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No samples available for review</p>
        <button
          onClick={loadNextSample}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Load Next Sample
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Golden Dataset Reviewer</h2>
            <p className="text-sm text-gray-500 mt-1">
              {document.vendorName && `${document.vendorName} • `}
              {document.category && `${document.category} • `}
              Confidence: {(document.confidenceScore * 100).toFixed(1)}%
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadNextSample}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Skip
            </button>
            <button
              onClick={saveLabel}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              Save & Next
            </button>
          </div>
        </div>
      </div>

      {/* Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Document Preview */}
        <div className="w-1/2 border-r border-gray-200 bg-gray-50 overflow-auto">
          <div className="p-6">
            <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <DocumentTextIcon className="h-5 w-5 text-gray-400" />
                <h3 className="font-semibold text-gray-900">{document.fileName}</h3>
              </div>
              <div className="text-sm text-gray-500">
                Preview of document (would show actual document in production)
              </div>
            </div>

            {/* Confidence Heatmap */}
            <div className="bg-white rounded-lg shadow-sm p-4">
              <h4 className="font-semibold text-gray-900 mb-3">Confidence Heatmap</h4>
              <div className="space-y-2">
                {Object.entries(document.extractedFields).map(([fieldName, field]) => (
                  <div key={fieldName} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700">{fieldName}</span>
                        <span
                          className={`text-xs px-2 py-1 rounded ${getConfidenceColor(field.confidence)}`}
                        >
                          {(field.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={getConfidenceHeatmap(field.confidence)}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Extracted Fields & Ledger Suggestions */}
        <div className="w-1/2 overflow-auto">
          <div className="p-6 space-y-6">
            {/* Extracted Fields */}
            <div className="bg-white rounded-lg shadow-sm p-4">
              <h3 className="font-semibold text-gray-900 mb-4">Extracted Fields</h3>
              <div className="space-y-4">
                {Object.entries(document.extractedFields).map(([fieldName, field]) => (
                  <div
                    key={fieldName}
                    className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                      selectedField === fieldName
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => setSelectedField(fieldName)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700">{fieldName}</label>
                      <span
                        className={`text-xs px-2 py-1 rounded ${getConfidenceColor(field.confidence)}`}
                      >
                        {(field.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="text-sm text-gray-900 mb-2">
                      {String(field.value || 'N/A')}
                    </div>
                    {selectedField === fieldName && (
                      <input
                        type="text"
                        defaultValue={String(field.value || '')}
                        onChange={(e) =>
                          setFieldCorrections((prev) => ({
                            ...prev,
                            [fieldName]: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Enter corrected value"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Ledger Posting Suggestions */}
            {document.suggestedLedgerPosting && (
              <div className="bg-white rounded-lg shadow-sm p-4">
                <h3 className="font-semibold text-gray-900 mb-4">Suggested Ledger Posting</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {document.suggestedLedgerPosting.accountName}
                      </div>
                      <div className="text-xs text-gray-500">
                        {document.suggestedLedgerPosting.accountCode}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`text-sm font-semibold ${
                          document.suggestedLedgerPosting.entryType === 'debit'
                            ? 'text-red-600'
                            : 'text-green-600'
                        }`}
                      >
                        {document.suggestedLedgerPosting.entryType === 'debit' ? 'Dr' : 'Cr'}{' '}
                        {document.suggestedLedgerPosting.amount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="accept-posting"
                      className="rounded"
                    />
                    <label htmlFor="accept-posting" className="text-sm text-gray-700">
                      Accept suggested posting
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Anomaly Tagging */}
            <div className="bg-white rounded-lg shadow-sm p-4">
              <h3 className="font-semibold text-gray-900 mb-4">Anomaly Detection</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is-anomaly"
                    checked={isAnomaly}
                    onChange={(e) => setIsAnomaly(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="is-anomaly" className="text-sm font-medium text-gray-700">
                    Mark as anomaly
                  </label>
                </div>
                {isAnomaly && (
                  <textarea
                    value={anomalyReason}
                    onChange={(e) => setAnomalyReason(e.target.value)}
                    placeholder="Describe the anomaly..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Hint */}
      <div className="bg-gray-50 border-t border-gray-200 px-6 py-2">
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>
            <kbd className="px-2 py-1 bg-white border border-gray-300 rounded">Tab</kbd> Next field
          </span>
          <span>
            <kbd className="px-2 py-1 bg-white border border-gray-300 rounded">Enter</kbd> Save & Next
          </span>
          <span>
            <kbd className="px-2 py-1 bg-white border border-gray-300 rounded">Esc</kbd> Skip
          </span>
        </div>
      </div>
    </div>
  );
}
