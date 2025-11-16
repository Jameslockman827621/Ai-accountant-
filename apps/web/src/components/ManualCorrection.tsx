'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ManualCorrection');

interface ExtractedField {
  field: string;
  value: unknown;
  confidence: number;
  editable: boolean;
}

interface ManualCorrectionProps {
  documentId: string;
  onSave?: (corrections: Record<string, unknown>) => void;
  onCancel?: () => void;
}

export default function ManualCorrection({
  documentId,
  onSave,
  onCancel,
}: ManualCorrectionProps) {
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [corrections, setCorrections] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadDocumentData();
  }, [documentId]);

  const loadDocumentData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/documents/${documentId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load document');

      const data = await response.json();
      const extractedData = data.document?.extracted_data || {};
      const confidenceScore = data.document?.confidence_score || 0;

      const fieldList: ExtractedField[] = [
        { field: 'vendor', value: extractedData.vendor, confidence: confidenceScore, editable: true },
        { field: 'date', value: extractedData.date, confidence: confidenceScore, editable: true },
        { field: 'total', value: extractedData.total, confidence: confidenceScore, editable: true },
        { field: 'tax', value: extractedData.tax, confidence: confidenceScore, editable: true },
        { field: 'description', value: extractedData.description, confidence: confidenceScore, editable: true },
      ].filter(f => f.value !== undefined && f.value !== null);

      setFields(fieldList);
    } catch (error) {
      logger.error('Failed to load document', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (field: string, value: unknown) => {
    setCorrections(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/documents/${documentId}/extractions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ corrections }),
      });

      if (!response.ok) throw new Error('Failed to save corrections');

      if (onSave) {
        onSave(corrections);
      }
      alert('Corrections saved successfully');
    } catch (error) {
      logger.error('Failed to save corrections', error);
      alert('Failed to save corrections');
    } finally {
      setSaving(false);
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-green-600';
    if (confidence >= 0.7) return 'text-yellow-600';
    return 'text-red-600';
  };

  if (loading) {
    return <div className="text-gray-500">Loading document data...</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Manual Correction</h2>
        <button
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>

      <p className="text-sm text-gray-600 mb-6">
        Review and correct extracted data. Changes will be saved to the document.
      </p>

      <div className="space-y-4">
        {fields.map((field) => (
          <div key={field.field} className="border rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="font-medium capitalize">{field.field}</label>
              <span className={`text-xs ${getConfidenceColor(field.confidence)}`}>
                Confidence: {(field.confidence * 100).toFixed(1)}%
              </span>
            </div>
            {field.field === 'date' ? (
              <input
                type="date"
                defaultValue={field.value ? new Date(String(field.value)).toISOString().split('T')[0] : ''}
                onChange={(e) => handleFieldChange(field.field, e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            ) : field.field === 'total' || field.field === 'tax' ? (
              <input
                type="number"
                step="0.01"
                defaultValue={String(field.value || '')}
                onChange={(e) => handleFieldChange(field.field, parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            ) : (
              <input
                type="text"
                defaultValue={String(field.value || '')}
                onChange={(e) => handleFieldChange(field.field, e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            )}
            {corrections[field.field] !== undefined && (
              <p className="text-xs text-blue-600 mt-1">Modified</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 flex gap-4">
        <button
          onClick={handleSave}
          disabled={saving || Object.keys(corrections).length === 0}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Corrections'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
