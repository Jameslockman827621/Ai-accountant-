'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('DataExport');

interface DataExport {
  id: string;
  format: 'json' | 'csv' | 'sql';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  downloadUrl?: string;
  expiresAt?: string;
  createdAt: string;
  completedAt?: string;
}

export default function DataExport() {
  const [exports, setExports] = useState<DataExport[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<'json' | 'csv' | 'sql'>('json');

  useEffect(() => {
    loadExports();
  }, []);

  const loadExports = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/backup/exports', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load exports');

      const data = await response.json();
      setExports(data.exports || []);
    } catch (error) {
      logger.error('Failed to load exports', error);
    } finally {
      setLoading(false);
    }
  };

  const requestExport = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/backup/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ format: selectedFormat }),
      });

      if (!response.ok) throw new Error('Failed to request export');

      const data = await response.json();
      alert('Data export started. You will be notified when it\'s ready.');
      await loadExports();
    } catch (error) {
      logger.error('Failed to request export', error);
      alert('Failed to start data export');
    } finally {
      setExporting(false);
    }
  };

  const downloadExport = async (exportId: string) => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/backup/exports/${exportId}/download`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to download export');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `data-export-${exportId}.${selectedFormat}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      logger.error('Failed to download export', error);
      alert('Failed to download export');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'processing':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold mb-4">Data Export (GDPR)</h2>

      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded">
        <p className="text-sm text-blue-800">
          <strong>Your Right to Data Portability:</strong> Under GDPR, you have the right to receive
          your personal data in a structured, commonly used format. You can request an export of all
          your data at any time.
        </p>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Export Format
        </label>
        <select
          value={selectedFormat}
          onChange={(e) => setSelectedFormat(e.target.value as 'json' | 'csv' | 'sql')}
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        >
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
          <option value="sql">SQL</option>
        </select>
      </div>

      <button
        onClick={requestExport}
        disabled={exporting}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {exporting ? 'Requesting Export...' : 'Request Data Export'}
      </button>

      {exports.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold mb-3">Export History</h3>
          <div className="space-y-3">
            {exports.map((exp) => (
              <div
                key={exp.id}
                className="border rounded-lg p-4"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <p className="font-semibold">Export {exp.id.substring(0, 8)}</p>
                      <span className={`px-2 py-1 rounded text-xs ${getStatusColor(exp.status)}`}>
                        {exp.status.toUpperCase()}
                      </span>
                      <span className="text-xs text-gray-600">{exp.format.toUpperCase()}</span>
                    </div>
                    <p className="text-sm text-gray-600">
                      Created: {new Date(exp.createdAt).toLocaleString()}
                    </p>
                    {exp.expiresAt && (
                      <p className="text-xs text-gray-500">
                        Expires: {new Date(exp.expiresAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                  {exp.status === 'completed' && exp.downloadUrl && (
                    <button
                      onClick={() => downloadExport(exp.id)}
                      className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      Download
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && exports.length === 0 && (
        <div className="text-center py-8 text-gray-500">Loading exports...</div>
      )}

      {!loading && exports.length === 0 && (
        <div className="text-center py-8 text-gray-500">No exports yet</div>
      )}
    </div>
  );
}
