'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ExtractionEditor');

interface Field {
  name: string;
  label: string;
  value: unknown;
  confidence: number;
  type: 'text' | 'number' | 'date' | 'currency';
  required: boolean;
}

interface ExtractionEditorProps {
  documentId: string;
  onSave?: (extractions: Record<string, unknown>) => void;
}

export default function ExtractionEditor({ documentId, onSave }: ExtractionEditorProps) {
  const [fields, setFields] = useState<Field[]>([]);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadExtractions();
  }, [documentId]);

  const loadExtractions = async () => {
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
      const extracted = data.document?.extracted_data || {};
      const confidence = data.document?.confidence_score || 0;

        const fieldList: Field[] = [
          { name: 'vendor', label: 'Vendor', value: extracted.vendor, confidence, type: 'text' as const, required: true },
          { name: 'date', label: 'Date', value: extracted.date, confidence, type: 'date' as const, required: true },
          { name: 'total', label: 'Total Amount', value: extracted.total, confidence, type: 'currency' as const, required: true },
          { name: 'tax', label: 'Tax Amount', value: extracted.tax, confidence, type: 'currency' as const, required: false },
          { name: 'description', label: 'Description', value: extracted.description, confidence, type: 'text' as const, required: false },
          { name: 'invoice_number', label: 'Invoice Number', value: extracted.invoice_number, confidence, type: 'text' as const, required: false },
        ].filter(f => f.value !== undefined && f.value !== null);

      setFields(fieldList);
    } catch (error) {
      logger.error('Failed to load extractions', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFieldEdit = (fieldName: string, value: unknown) => {
    setEdits(prev => ({ ...prev, [fieldName]: value }));
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
        body: JSON.stringify({ extractions: edits }),
      });

      if (!response.ok) throw new Error('Failed to save extractions');

      if (onSave) {
        onSave(edits);
      }
      alert('Extractions saved successfully');
      setEdits({});
      await loadExtractions();
    } catch (error) {
      logger.error('Failed to save extractions', error);
      alert('Failed to save extractions');
    } finally {
      setSaving(false);
    }
  };

  const renderFieldInput = (field: Field) => {
    const currentValue = edits[field.name] !== undefined ? edits[field.name] : field.value;
    const hasEdit = edits[field.name] !== undefined;

    switch (field.type) {
      case 'date':
        return (
          <input
            type="date"
            value={currentValue ? new Date(String(currentValue)).toISOString().split('T')[0] : ''}
            onChange={(e) => handleFieldEdit(field.name, e.target.value)}
            className={`w-full px-3 py-2 border rounded-md ${
              hasEdit ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
            }`}
          />
        );
      case 'currency':
      case 'number':
        return (
          <input
            type="number"
            step={field.type === 'currency' ? '0.01' : '1'}
            value={String(currentValue || '')}
            onChange={(e) => handleFieldEdit(field.name, parseFloat(e.target.value) || 0)}
            className={`w-full px-3 py-2 border rounded-md ${
              hasEdit ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
            }`}
          />
        );
      default:
        return (
          <input
            type="text"
            value={String(currentValue || '')}
            onChange={(e) => handleFieldEdit(field.name, e.target.value)}
            className={`w-full px-3 py-2 border rounded-md ${
              hasEdit ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
            }`}
          />
        );
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading extractions...</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Extraction Editor</h2>
        <button
          onClick={handleSave}
          disabled={saving || Object.keys(edits).length === 0}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      <div className="space-y-4">
        {fields.map((field) => (
          <div key={field.name} className="border rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="font-medium">
                {field.label}
                {field.required && <span className="text-red-600 ml-1">*</span>}
              </label>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${
                  field.confidence >= 0.9 ? 'text-green-600' :
                  field.confidence >= 0.7 ? 'text-yellow-600' :
                  'text-red-600'
                }`}>
                  Confidence: {(field.confidence * 100).toFixed(1)}%
                </span>
                {edits[field.name] !== undefined && (
                  <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">
                    Edited
                  </span>
                )}
              </div>
            </div>
            {renderFieldInput(field)}
            {edits[field.name] !== undefined && (
              <p className="text-xs text-gray-500 mt-1">
                Original: {String(field.value)} → New: {String(edits[field.name])}
              </p>
            )}
          </div>
        ))}
      </div>

      {Object.keys(edits).length > 0 && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded">
          <p className="text-sm text-blue-800">
            <strong>{Object.keys(edits).length}</strong> field(s) modified. Click "Save Changes" to apply.
          </p>
        </div>
      )}
    </div>
  );
}
