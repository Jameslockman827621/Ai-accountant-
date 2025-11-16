'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('DuplicateDetector');

interface DuplicateGroup {
  id: string;
  documents: Array<{
    id: string;
    fileName: string;
    uploadedAt: string;
    amount?: number;
    vendor?: string;
    date?: string;
    similarity: number; // 0-1
  }>;
  confidence: number; // 0-1
}

interface DuplicateDetectorProps {
  token: string;
  documentId?: string; // If provided, check for duplicates of this document
  onDuplicateClick?: (documentId: string) => void;
}

export default function DuplicateDetector({
  token,
  documentId,
  onDuplicateClick,
}: DuplicateDetectorProps) {
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<'detect' | 'review'>('detect');

  useEffect(() => {
    if (action === 'review') {
      loadDuplicates();
    }
  }, [action, documentId]);

  const detectDuplicates = async () => {
    setLoading(true);
    try {
      const url = documentId
        ? `/api/documents/${documentId}/duplicates/detect`
        : '/api/documents/duplicates/detect';
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to detect duplicates');

      const data = await response.json();
      setDuplicates(data.duplicates || []);
      setAction('review');
    } catch (error) {
      logger.error('Failed to detect duplicates', error);
      alert('Failed to detect duplicates');
    } finally {
      setLoading(false);
    }
  };

  const loadDuplicates = async () => {
    setLoading(true);
    try {
      const url = documentId
        ? `/api/documents/${documentId}/duplicates`
        : '/api/documents/duplicates';
      
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load duplicates');

      const data = await response.json();
      setDuplicates(data.duplicates || []);
    } catch (error) {
      logger.error('Failed to load duplicates', error);
    } finally {
      setLoading(false);
    }
  };

  const markAsNotDuplicate = async (groupId: string, documentId: string) => {
    try {
      const response = await fetch(`/api/documents/duplicates/${groupId}/exclude`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ documentId }),
      });

      if (!response.ok) throw new Error('Failed to exclude document');

      await loadDuplicates();
    } catch (error) {
      logger.error('Failed to exclude document', error);
      alert('Failed to exclude document from duplicate group');
    }
  };

  const deleteDuplicate = async (documentId: string) => {
    if (!confirm('Are you sure you want to delete this duplicate document?')) return;

    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to delete document');

      await loadDuplicates();
    } catch (error) {
      logger.error('Failed to delete document', error);
      alert('Failed to delete document');
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-red-600 bg-red-50 border-red-200';
    if (confidence >= 0.7) return 'text-orange-600 bg-orange-50 border-orange-200';
    return 'text-yellow-600 bg-yellow-50 border-yellow-200';
  };

  if (action === 'detect') {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">Duplicate Detection</h2>
        <p className="text-gray-600 mb-6">
          {documentId
            ? 'Check if this document has duplicates in your system.'
            : 'Scan all documents for potential duplicates.'}
        </p>
        <button
          onClick={detectDuplicates}
          disabled={loading}
          className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Detecting...' : 'Detect Duplicates'}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-2xl font-bold">Duplicate Documents</h2>
          <p className="text-sm text-gray-600 mt-1">
            Found {duplicates.length} duplicate group{duplicates.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setAction('detect')}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
        >
          Re-scan
        </button>
      </div>

      {loading && duplicates.length === 0 ? (
        <div className="text-center py-8 text-gray-500">Loading duplicates...</div>
      ) : duplicates.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p className="text-lg">✅ No duplicates found</p>
          <p className="text-sm mt-2">All documents appear to be unique.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {duplicates.map((group) => (
            <div
              key={group.id}
              className={`p-4 rounded-lg border-2 ${getConfidenceColor(group.confidence)}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">📋</span>
                  <h3 className="font-semibold">
                    Potential Duplicate Group ({group.documents.length} documents)
                  </h3>
                  <span className="text-xs px-2 py-1 bg-white rounded">
                    {(group.confidence * 100).toFixed(0)}% confidence
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {group.documents.map((doc, index) => (
                  <div
                    key={doc.id}
                    className="bg-white p-3 rounded border border-gray-200 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <span className="text-gray-400">#{index + 1}</span>
                      <div className="flex-1">
                        <p
                          className="font-medium cursor-pointer hover:text-blue-600"
                          onClick={() => onDuplicateClick && onDuplicateClick(doc.id)}
                        >
                          {doc.fileName}
                        </p>
                        <div className="flex gap-4 text-xs text-gray-600 mt-1">
                          {doc.vendor && <span>Vendor: {doc.vendor}</span>}
                          {doc.amount && <span>Amount: £{doc.amount.toFixed(2)}</span>}
                          {doc.date && <span>Date: {new Date(doc.date).toLocaleDateString()}</span>}
                          <span>Similarity: {(doc.similarity * 100).toFixed(0)}%</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Uploaded: {new Date(doc.uploadedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => markAsNotDuplicate(group.id, doc.id)}
                        className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                      >
                        Not Duplicate
                      </button>
                      {index > 0 && (
                        <button
                          onClick={() => deleteDuplicate(doc.id)}
                          className="px-3 py-1 text-xs bg-red-200 text-red-700 rounded hover:bg-red-300"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
