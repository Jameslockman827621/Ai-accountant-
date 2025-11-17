'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ZoomInIcon,
  ZoomOutIcon,
  ArrowPathIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { DocumentTextIcon } from '@heroicons/react/24/solid';

interface Document {
  id: string;
  fileName: string;
  documentType: string;
  extractedFields: Record<string, {
    value: unknown;
    confidence: number;
    calibratedConfidence?: number;
  }>;
  suggestedLedgerPosting?: {
    accountCode: string;
    accountName: string;
    amount: number;
    entryType: 'debit' | 'credit';
  };
  reasoningTrace?: {
    decisionPath: Array<{
      step: number;
      description: string;
      confidence: number;
      reasoning: string;
    }>;
    features: Record<string, number>;
    weights: Record<string, number>;
  };
  qualityMetrics?: {
    accuracyScore: number;
    completenessScore: number;
    complianceRiskScore: number;
    compositeQualityScore: number;
  };
  historicalContext?: Array<{
    documentId: string;
    fileName: string;
    date: string;
    reviewerNotes?: string;
  }>;
  vendorName?: string;
  category?: string;
}

interface WorldClassReviewerWorkbenchProps {
  tenantId: string;
  queueId?: string;
  onComplete?: () => void;
}

export default function WorldClassReviewerWorkbench({
  tenantId,
  queueId,
  onComplete,
}: WorldClassReviewerWorkbenchProps) {
  const [document, setDocument] = useState<Document | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [fieldEdits, setFieldEdits] = useState<Record<string, unknown>>({});
  const [ledgerEdit, setLedgerEdit] = useState<Document['suggestedLedgerPosting'] | null>(null);
  const [notes, setNotes] = useState('');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [showReasoning, setShowReasoning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [lockStatus, setLockStatus] = useState<'unlocked' | 'locked' | 'conflict'>('unlocked');
  
  const autosaveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lockCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadDocument();
    
    // Setup autosave (every 30 seconds)
    autosaveIntervalRef.current = setInterval(() => {
      if (Object.keys(fieldEdits).length > 0 || notes) {
        autosave();
      }
    }, 30000);

    // Setup optimistic locking check (every 10 seconds)
    lockCheckIntervalRef.current = setInterval(() => {
      checkLock();
    }, 10000);

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + S: Save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      // Tab: Next field
      if (e.key === 'Tab' && !e.shiftKey && selectedField) {
        e.preventDefault();
        navigateToNextField();
      }
      // Shift + Tab: Previous field
      if (e.key === 'Tab' && e.shiftKey && selectedField) {
        e.preventDefault();
        navigateToPreviousField();
      }
      // Enter: Save and next (when in field edit mode)
      if (e.key === 'Enter' && e.ctrlKey && selectedField) {
        e.preventDefault();
        handleSaveAndNext();
      }
      // Esc: Cancel edit
      if (e.key === 'Escape') {
        setSelectedField(null);
      }
      // Arrow keys: Navigate
      if (e.key === 'ArrowRight' && e.ctrlKey) {
        e.preventDefault();
        loadNextDocument();
      }
      if (e.key === 'ArrowLeft' && e.ctrlKey) {
        e.preventDefault();
        loadPreviousDocument();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (autosaveIntervalRef.current) {
        clearInterval(autosaveIntervalRef.current);
      }
      if (lockCheckIntervalRef.current) {
        clearInterval(lockCheckIntervalRef.current);
      }
    };
  }, [queueId, fieldEdits, notes, selectedField]);

  const loadDocument = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const endpoint = queueId
        ? `/api/review-queue/${queueId}`
        : '/api/review-queue/next';

      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('Failed to load document');

      const data = await response.json();
      setDocument(data.document);
      setFieldEdits({});
      setNotes('');
      setSelectedField(null);
      setZoom(1);
      setRotation(0);
      setShowReasoning(false);
      setShowHistory(false);
    } catch (error) {
      console.error('Failed to load document', error);
    } finally {
      setLoading(false);
    }
  };

  const checkLock = async () => {
    if (!document) return;

    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/review-queue/${document.id}/lock-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setLockStatus(data.status);
      }
    } catch (error) {
      console.error('Failed to check lock', error);
    }
  };

  const autosave = async () => {
    if (!document || saving) return;

    setSaving(true);
    try {
      const token = localStorage.getItem('authToken');
      await fetch(`/api/review-queue/${document.id}/autosave`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fieldEdits,
          notes,
        }),
      });

      setLastSaved(new Date());
    } catch (error) {
      console.error('Autosave failed', error);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    await autosave();
  };

  const handleSaveAndNext = async () => {
    await handleSave();
    setTimeout(() => {
      loadNextDocument();
    }, 500);
  };

  const handleApprove = async () => {
    if (!document) return;

    setSaving(true);
    try {
      const token = localStorage.getItem('authToken');
      await fetch(`/api/review-queue/${document.id}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fieldCorrections: fieldEdits,
          ledgerCorrections: ledgerEdit ? { ...ledgerEdit } : undefined,
          notes,
        }),
      });

      if (onComplete) onComplete();
      loadNextDocument();
    } catch (error) {
      console.error('Failed to approve', error);
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!document) return;

    setSaving(true);
    try {
      const token = localStorage.getItem('authToken');
      await fetch(`/api/review-queue/${document.id}/reject`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          notes,
          fieldCorrections: fieldEdits,
        }),
      });

      if (onComplete) onComplete();
      loadNextDocument();
    } catch (error) {
      console.error('Failed to reject', error);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!document) return;

    setSaving(true);
    try {
      const token = localStorage.getItem('authToken');
      await fetch(`/api/review-queue/${document.id}/edit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fieldCorrections: fieldEdits,
          ledgerCorrections: ledgerEdit ? { ...ledgerEdit } : undefined,
          notes,
        }),
      });

      if (onComplete) onComplete();
      loadNextDocument();
    } catch (error) {
      console.error('Failed to save edit', error);
    } finally {
      setSaving(false);
    }
  };

  const loadNextDocument = () => {
    loadDocument();
  };

  const loadPreviousDocument = () => {
    // Would load previous document from history
    loadDocument();
  };

  const navigateToNextField = () => {
    if (!document) return;
    const fields = Object.keys(document.extractedFields);
    const currentIndex = selectedField ? fields.indexOf(selectedField) : -1;
    const nextIndex = (currentIndex + 1) % fields.length;
    setSelectedField(fields[nextIndex]);
  };

  const navigateToPreviousField = () => {
    if (!document) return;
    const fields = Object.keys(document.extractedFields);
    const currentIndex = selectedField ? fields.indexOf(selectedField) : -1;
    const prevIndex = currentIndex <= 0 ? fields.length - 1 : currentIndex - 1;
    setSelectedField(fields[prevIndex]);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-green-600 bg-green-50 border-green-200';
    if (confidence >= 0.7) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.9) return 'High';
    if (confidence >= 0.7) return 'Medium';
    return 'Low';
  };

  if (loading && !document) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!document) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-gray-500 text-lg mb-4">No documents in review queue</p>
          <button
            onClick={loadDocument}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Load Next Document
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={loadPreviousDocument}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"
            title="Previous (Ctrl+Left)"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <button
            onClick={loadNextDocument}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"
            title="Next (Ctrl+Right)"
          >
            <ArrowRightIcon className="h-5 w-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">{document.fileName}</h2>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-gray-500">
                {document.vendorName && `${document.vendorName} • `}
                {document.category && `${document.category} • `}
                {document.documentType}
              </span>
              {document.qualityMetrics && (
                <span
                  className={`text-xs px-2 py-1 rounded ${getConfidenceColor(
                    document.qualityMetrics.compositeQualityScore
                  )}`}
                >
                  Quality: {(document.qualityMetrics.compositeQualityScore * 100).toFixed(0)}%
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saving && (
            <span className="text-sm text-gray-500 flex items-center gap-1">
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              Saving...
            </span>
          )}
          {lastSaved && (
            <span className="text-xs text-gray-400">
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          {lockStatus === 'locked' && (
            <span className="text-xs text-yellow-600 flex items-center gap-1">
              <ExclamationTriangleIcon className="h-4 w-4" />
              Locked by another reviewer
            </span>
          )}
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 flex items-center gap-1"
          >
            <InformationCircleIcon className="h-4 w-4" />
            Reasoning
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            History
          </button>
        </div>
      </div>

      {/* Main Content - Split Pane */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Document Preview */}
        <div className="w-1/2 border-r border-gray-200 bg-gray-50 flex flex-col">
          {/* Document Preview Controls */}
          <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
              >
                <ZoomOutIcon className="h-4 w-4" />
              </button>
              <span className="text-sm text-gray-600 min-w-[60px] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom(Math.min(2, zoom + 0.1))}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
              >
                <ZoomInIcon className="h-4 w-4" />
              </button>
              <button
                onClick={() => setRotation((rotation + 90) % 360)}
                className="ml-4 p-1.5 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
              >
                <ArrowPathIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="text-xs text-gray-500">Page 1 of 1</div>
          </div>

          {/* Document Preview */}
          <div className="flex-1 overflow-auto p-6 flex items-center justify-center">
            <div
              className="bg-white shadow-lg rounded-lg p-4"
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                transformOrigin: 'center',
              }}
            >
              <div className="w-full h-full flex items-center justify-center border-2 border-dashed border-gray-300 rounded">
                <div className="text-center p-12">
                  <DocumentTextIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">Document Preview</p>
                  <p className="text-sm text-gray-400 mt-2">
                    {document.fileName}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Extracted Fields & Actions */}
        <div className="w-1/2 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-6 space-y-6">
            {/* Reasoning Trace (if shown) */}
            {showReasoning && document.reasoningTrace && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <h3 className="font-semibold text-blue-900 mb-3">AI Reasoning Trace</h3>
                <div className="space-y-2">
                  {document.reasoningTrace.decisionPath.map((step) => (
                    <div key={step.step} className="text-sm">
                      <div className="font-medium text-blue-800">
                        Step {step.step}: {step.description}
                      </div>
                      <div className="text-blue-700 mt-1">{step.reasoning}</div>
                      <div className="text-xs text-blue-600 mt-1">
                        Confidence: {(step.confidence * 100).toFixed(1)}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Historical Context (if shown) */}
            {showHistory && document.historicalContext && document.historicalContext.length > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
                <h3 className="font-semibold text-purple-900 mb-3">Previous Documents</h3>
                <div className="space-y-2">
                  {document.historicalContext.map((prev) => (
                    <div key={prev.documentId} className="text-sm">
                      <div className="font-medium text-purple-800">{prev.fileName}</div>
                      <div className="text-purple-700 text-xs">{prev.date}</div>
                      {prev.reviewerNotes && (
                        <div className="text-purple-600 text-xs mt-1 italic">
                          {prev.reviewerNotes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Extracted Fields */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900 mb-4">Extracted Fields</h3>
              <div className="space-y-3">
                {Object.entries(document.extractedFields).map(([fieldName, field]) => {
                  const isSelected = selectedField === fieldName;
                  const editedValue = fieldEdits[fieldName];
                  const displayValue = editedValue !== undefined ? editedValue : field.value;
                  const confidence = field.calibratedConfidence || field.confidence;

                  return (
                    <div
                      key={fieldName}
                      className={`border rounded-lg p-3 cursor-pointer transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => setSelectedField(fieldName)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-gray-700">
                          {fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}
                        </label>
                        <span
                          className={`text-xs px-2 py-1 rounded border ${getConfidenceColor(
                            confidence
                          )}`}
                        >
                          {getConfidenceBadge(confidence)}: {(confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      {isSelected ? (
                        <input
                          type="text"
                          value={String(displayValue || '')}
                          onChange={(e) =>
                            setFieldEdits((prev) => ({
                              ...prev,
                              [fieldName]: e.target.value,
                            }))
                          }
                          className="w-full px-3 py-2 border border-blue-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                          onBlur={() => setSelectedField(null)}
                        />
                      ) : (
                        <div className="text-sm text-gray-900">{String(displayValue || 'N/A')}</div>
                      )}
                      {editedValue !== undefined && editedValue !== field.value && (
                        <div className="text-xs text-green-600 mt-1 flex items-center gap-1">
                          <CheckCircleIcon className="h-3 w-3" />
                          Edited
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Suggested Ledger Posting */}
            {document.suggestedLedgerPosting && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
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
                      checked={ledgerEdit !== null}
                      onChange={(e) =>
                        setLedgerEdit(e.target.checked ? document.suggestedLedgerPosting || null : null)
                      }
                    />
                    <label htmlFor="accept-posting" className="text-sm text-gray-700">
                      Accept suggested posting
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900 mb-2">Review Notes</h3>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this review..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={4}
              />
            </div>
          </div>

          {/* Action Bar */}
          <div className="bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between">
            <div className="text-xs text-gray-500">
              <kbd className="px-2 py-1 bg-gray-100 border border-gray-300 rounded">Ctrl+S</kbd> Save •{' '}
              <kbd className="px-2 py-1 bg-gray-100 border border-gray-300 rounded">Tab</kbd> Next field •{' '}
              <kbd className="px-2 py-1 bg-gray-100 border border-gray-300 rounded">Ctrl+Enter</kbd> Save & Next
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleReject}
                className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 flex items-center gap-2"
              >
                <XCircleIcon className="h-4 w-4" />
                Reject
              </button>
              <button
                onClick={handleEdit}
                className="px-4 py-2 text-sm font-medium text-yellow-700 bg-yellow-50 rounded-md hover:bg-yellow-100"
              >
                Edit & Save
              </button>
              <button
                onClick={handleApprove}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 flex items-center gap-2"
              >
                <CheckCircleIcon className="h-4 w-4" />
                Approve
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
