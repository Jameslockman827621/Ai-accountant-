'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';
import { toError } from '@/utils/error';

const logger = createLogger('ApprovalWorkflow');

interface ApprovalStep {
  stepNumber: number;
  approverRole: string;
  approverId?: string;
  status: 'pending' | 'approved' | 'rejected' | 'delegated';
  required: boolean;
  comments?: string;
  signedAt?: string;
}

interface ApprovalWorkflow {
  id: string;
  tenantId: string;
  filingId?: string;
  workflowType: string;
  policyType: 'auto' | 'accountant_review' | 'client_signoff' | 'multi_level';
  status: 'pending' | 'in_progress' | 'approved' | 'rejected' | 'expired';
  steps: ApprovalStep[];
  currentStep: number;
  createdAt: string;
  completedAt?: string;
  expiresAt?: string;
}

interface ApprovalHistory {
  stepNumber: number;
  action: string;
  approverId: string;
  approverRole: string;
  comments: string | null;
  signedAt: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface ApprovalWorkflowProps {
  token: string;
  workflowId: string;
}

export default function ApprovalWorkflow({ token, workflowId }: ApprovalWorkflowProps) {
  const [workflow, setWorkflow] = useState<ApprovalWorkflow | null>(null);
  const [history, setHistory] = useState<ApprovalHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [comments, setComments] = useState('');
  const [currentStep, setCurrentStep] = useState<number | null>(null);

  useEffect(() => {
    loadWorkflow();
    loadHistory();
  }, [workflowId]);

  const loadWorkflow = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/workflows/approvals/${workflowId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load workflow');

      const data = await response.json();
      setWorkflow(data.workflow);
    } catch (error) {
      const err = toError(error, 'Failed to load workflow');
      logger.error('Failed to load workflow', err);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/workflows/approvals/${workflowId}/history`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setHistory(data.history || []);
      }
    } catch (error) {
      const err = toError(error, 'Failed to load history');
      logger.error('Failed to load history', err);
    }
  };

  const approveStep = async (stepNumber: number) => {
    setApproving(true);
    try {
      const response = await fetch(`${API_BASE}/api/workflows/approvals/${workflowId}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stepNumber,
          comments: comments || undefined,
          signatureHash: await generateSignatureHash(),
        }),
      });

      if (!response.ok) throw new Error('Failed to approve');

      await loadWorkflow();
      await loadHistory();
      setComments('');
      setCurrentStep(null);
    } catch (error) {
      const err = toError(error, 'Failed to approve step');
      logger.error('Failed to approve step', err);
      alert('Failed to approve step');
    } finally {
      setApproving(false);
    }
  };

  const rejectStep = async (stepNumber: number, reason: string) => {
    setApproving(true);
    try {
      const response = await fetch(`${API_BASE}/api/workflows/approvals/${workflowId}/reject`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stepNumber,
          reason,
        }),
      });

      if (!response.ok) throw new Error('Failed to reject');

      await loadWorkflow();
      await loadHistory();
    } catch (error) {
      const err = toError(error, 'Failed to reject workflow');
      logger.error('Failed to reject workflow', err);
      alert('Failed to reject workflow');
    } finally {
      setApproving(false);
    }
  };

  const generateSignatureHash = async (): Promise<string> => {
    // In production, would use actual digital signature
    const data = `${workflowId}-${Date.now()}-${token.substring(0, 10)}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
        Workflow not found
      </div>
    );
  }

  const canApproveCurrentStep = workflow.steps.some(
    step => step.stepNumber === workflow.currentStep && step.status === 'pending'
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Approval Workflow</h1>
          <p className="text-gray-600 mt-1">
            {workflow.workflowType} - {workflow.policyType.replace('_', ' ')}
          </p>
        </div>
        <StatusBadge status={workflow.status} />
      </div>

      {/* Workflow Steps */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Approval Steps</h2>
          <div className="space-y-4">
            {workflow.steps.map((step) => (
            <div
              key={step.stepNumber}
              className={`p-4 rounded-lg border ${
                step.stepNumber === workflow.currentStep
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <span className="text-sm font-medium text-gray-900">
                      Step {step.stepNumber}: {step.approverRole}
                    </span>
                    <StepStatusBadge status={step.status} />
                    {step.required && (
                      <span className="text-xs text-red-600 font-medium">Required</span>
                    )}
                  </div>
                  {step.comments && (
                    <p className="text-sm text-gray-600 mb-2">{step.comments}</p>
                  )}
                  {step.signedAt && (
                    <p className="text-xs text-gray-500">
                      Signed: {new Date(step.signedAt).toLocaleString()}
                    </p>
                  )}
                </div>
                {step.status === 'pending' &&
                  step.stepNumber === workflow.currentStep &&
                  canApproveCurrentStep && (
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setCurrentStep(step.stepNumber)}
                        className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Review
                      </button>
                    </div>
                  )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Approval Form */}
      {currentStep !== null && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Approve Step {currentStep}
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Comments (optional)
              </label>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={4}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                placeholder="Add any comments about this approval..."
              />
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => approveStep(currentStep)}
                disabled={approving}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {approving ? 'Approving...' : 'Approve'}
              </button>
              <button
                onClick={() => {
                  const reason = prompt('Reason for rejection:');
                  if (reason) rejectStep(currentStep, reason);
                }}
                disabled={approving}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                onClick={() => {
                  setCurrentStep(null);
                  setComments('');
                }}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Approval History</h2>
          <div className="space-y-3">
            {history.map((entry, index) => (
              <div key={index} className="p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-900">
                    Step {entry.stepNumber}: {entry.action}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(entry.signedAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-gray-600">
                  {entry.approverRole} - {entry.approverId}
                </p>
                {entry.comments && (
                  <p className="text-sm text-gray-700 mt-1">{entry.comments}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expiry Warning */}
      {workflow.expiresAt && new Date(workflow.expiresAt) > new Date() && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm text-yellow-800">
            This workflow expires on {new Date(workflow.expiresAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ApprovalWorkflow['status'] }) {
  const colors = {
    pending: 'bg-yellow-100 text-yellow-800',
    in_progress: 'bg-blue-100 text-blue-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    expired: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${colors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
    </span>
  );
}

function StepStatusBadge({ status }: { status: ApprovalStep['status'] }) {
  const colors = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    delegated: 'bg-purple-100 text-purple-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
