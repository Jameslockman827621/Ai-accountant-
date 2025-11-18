'use client';

import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('CSVUpload');

interface DetectedSchema {
  columns: Array<{
    name: string;
    type: 'string' | 'number' | 'date' | 'currency' | 'unknown';
    sampleValues: string[];
  }>;
  delimiter: string;
  hasHeader: boolean;
  rowCount: number;
  suggestedMappings: Record<string, string>;
}

interface FieldMapping {
  csvColumn: string;
  targetField: string;
  transformation?: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface CSVUploadProps {
  token: string;
  tenantId: string;
}

export default function CSVUpload({ token, tenantId: _tenantId }: CSVUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [schema, setSchema] = useState<DetectedSchema | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const [selectedFile] = acceptedFiles;
    if (!selectedFile) {
      return;
    }
    setFile(selectedFile);
    setUploadStatus('idle');

    // Detect schema
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(`${API_BASE}/api/csv-dropzone/detect-schema`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) throw new Error('Failed to detect schema');

      const data = await response.json();
      setSchema(data.schema);

      // Initialize mappings from suggestions
      const initialMappings: FieldMapping[] = Object.entries(data.schema.suggestedMappings).map(
        ([csvColumn, targetField]) => ({
          csvColumn,
          targetField: targetField as string,
        })
      );
      setMappings(initialMappings);
    } catch (error) {
      logger.error('Failed to detect schema', error);
      alert('Failed to analyze file. Please check the file format.');
    }
  }, [token]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
  });

  const updateMapping = (index: number, field: Partial<FieldMapping>) => {
    setMappings((prev) => {
      const updated = [...prev];
      const current = updated[index];
      if (!current) {
        return prev;
      }
      const next: FieldMapping = {
        csvColumn: field.csvColumn ?? current.csvColumn,
        targetField: field.targetField ?? current.targetField,
      };
      if (field.transformation !== undefined) {
        if (field.transformation === '') {
          // Remove transformation when clearing input
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete next.transformation;
        } else {
          next.transformation = field.transformation;
        }
      } else if (current.transformation !== undefined) {
        next.transformation = current.transformation;
      }
      updated[index] = next;
      return updated;
    });
  };

  const handleUpload = async () => {
    if (!file || !schema) return;

    setUploading(true);
    setUploadStatus('idle');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mappings', JSON.stringify(mappings));
      formData.append('schema', JSON.stringify(schema));

      const response = await fetch(`${API_BASE}/api/csv-dropzone/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      setUploadStatus('success');
      
      // Reset after success
      setTimeout(() => {
        setFile(null);
        setSchema(null);
        setMappings([]);
        setUploadStatus('idle');
      }, 3000);
    } catch (error) {
      logger.error('Upload failed', error);
      setUploadStatus('error');
      alert('Failed to upload file. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const targetFields = [
    { value: 'date', label: 'Date' },
    { value: 'description', label: 'Description' },
    { value: 'amount', label: 'Amount' },
    { value: 'vendor', label: 'Vendor' },
    { value: 'category', label: 'Category' },
    { value: 'account', label: 'Account' },
    { value: 'reference', label: 'Reference' },
    { value: 'tax_amount', label: 'Tax Amount' },
    { value: 'skip', label: 'Skip Column' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">CSV/Excel Import</h1>
        <p className="text-gray-600 mt-1">Upload and map your financial data</p>
      </div>

      {/* File Upload */}
      {!file && (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
            isDragActive
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <input {...getInputProps()} />
          <div className="space-y-4">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              stroke="currentColor"
              fill="none"
              viewBox="0 0 48 48"
            >
              <path
                d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-4h12m-4 4v12m0 0l-4-4m4 4l4-4"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div>
              <p className="text-lg font-medium text-gray-900">
                {isDragActive ? 'Drop file here' : 'Drag and drop a file here'}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                or click to browse (CSV, XLS, XLSX)
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Schema Detection & Mapping */}
      {file && schema && (
        <div className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">File: {file.name}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {schema.rowCount.toLocaleString()} rows detected
                </p>
              </div>
              <button
                onClick={() => {
                  setFile(null);
                  setSchema(null);
                  setMappings([]);
                }}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Remove
              </button>
            </div>

            {/* Detected Columns */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Detected Columns</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {schema.columns.map((col, idx) => (
                  <div key={idx} className="p-2 bg-gray-50 rounded text-sm">
                    <p className="font-medium text-gray-900">{col.name}</p>
                    <p className="text-xs text-gray-500 capitalize">{col.type}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Field Mappings */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Map Columns to Fields</h3>
              <div className="space-y-3">
                {schema.columns.map((col, idx) => {
                  const mapping = mappings.find(m => m.csvColumn === col.name);
                  return (
                    <div key={idx} className="flex items-center space-x-4">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{col.name}</p>
                        <p className="text-xs text-gray-500">
                          Type: {col.type} • Sample: {col.sampleValues[0] || 'N/A'}
                        </p>
                      </div>
                      <div className="w-64">
                        <select
                          value={mapping?.targetField || 'skip'}
                          onChange={(e) => {
                            const existingIndex = mappings.findIndex(m => m.csvColumn === col.name);
                            if (existingIndex >= 0) {
                              updateMapping(existingIndex, { targetField: e.target.value });
                            } else {
                              setMappings([
                                ...mappings,
                                { csvColumn: col.name, targetField: e.target.value },
                              ]);
                            }
                          }}
                          className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                        >
                          {targetFields.map(field => (
                            <option key={field.value} value={field.value}>
                              {field.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Upload Button */}
          <div className="flex items-center justify-end space-x-4">
            {uploadStatus === 'success' && (
              <span className="text-sm text-green-600">Upload successful!</span>
            )}
            {uploadStatus === 'error' && (
              <span className="text-sm text-red-600">Upload failed. Please try again.</span>
            )}
            <button
              onClick={handleUpload}
              disabled={uploading || mappings.length === 0}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? 'Uploading...' : 'Upload & Import'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
