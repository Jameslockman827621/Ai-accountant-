'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('Security-Center');

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface SecurityCenterProps {
  token: string;
  tenantId: string;
}

/**
 * Security Center Component (Chunk 3)
 * Shows encryption status, compliance checklists, and pending access reviews
 */
export default function SecurityCenter({ token, tenantId }: SecurityCenterProps) {
  const [encryptionStatus, setEncryptionStatus] = useState<{
    atRest: boolean;
    inTransit: boolean;
    keyManagement: string;
  } | null>(null);
  const [complianceStatus, setComplianceStatus] = useState<{
    soc2: boolean;
    gdpr: boolean;
    iso27001: boolean;
  } | null>(null);
  const [pendingReviews, setPendingReviews] = useState<Array<{
    id: string;
    userId: string;
    userName: string;
    requestedRole: string;
    requestedAt: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load encryption status
      const encRes = await fetch(`${API_BASE}/api/security/encryption-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (encRes.ok) {
        const encData = await encRes.json();
        setEncryptionStatus(encData);
      }

      // Load compliance status
      const compRes = await fetch(`${API_BASE}/api/security/compliance-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (compRes.ok) {
        const compData = await compRes.json();
        setComplianceStatus(compData);
      }

      // Load pending access reviews
      const reviewsRes = await fetch(`${API_BASE}/api/security/access-requests?status=pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (reviewsRes.ok) {
        const reviewsData = await reviewsRes.json();
        setPendingReviews(reviewsData.requests || []);
      }
    } catch (error) {
      logger.error('Failed to load security data', error);
    } finally {
      setLoading(false);
    }
  };

  const approveRequest = async (requestId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/security/access-requests/${requestId}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        loadData();
      }
    } catch (error) {
      logger.error('Failed to approve request', error);
    }
  };

  const rejectRequest = async (requestId: string, reason: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/security/access-requests/${requestId}/reject`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        loadData();
      }
    } catch (error) {
      logger.error('Failed to reject request', error);
    }
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Security Center</h1>
        <p className="text-gray-600 mt-1">Encryption, compliance, and access management</p>
      </div>

      {/* Encryption Status */}
      {encryptionStatus && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Encryption Status</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`p-4 rounded-lg border-2 ${encryptionStatus.atRest ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <p className="font-medium mb-1">At Rest</p>
              <p className={`text-sm ${encryptionStatus.atRest ? 'text-green-800' : 'text-red-800'}`}>
                {encryptionStatus.atRest ? '✓ Encrypted' : '✗ Not Encrypted'}
              </p>
            </div>
            <div className={`p-4 rounded-lg border-2 ${encryptionStatus.inTransit ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <p className="font-medium mb-1">In Transit</p>
              <p className={`text-sm ${encryptionStatus.inTransit ? 'text-green-800' : 'text-red-800'}`}>
                {encryptionStatus.inTransit ? '✓ TLS/SSL' : '✗ Not Encrypted'}
              </p>
            </div>
            <div className="p-4 rounded-lg border-2 border-blue-200 bg-blue-50">
              <p className="font-medium mb-1">Key Management</p>
              <p className="text-sm text-blue-800">{encryptionStatus.keyManagement}</p>
            </div>
          </div>
        </div>
      )}

      {/* Compliance Checklist */}
      {complianceStatus && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Compliance Status</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="font-medium">SOC 2 Type II</span>
              <span className={complianceStatus.soc2 ? 'text-green-600 font-medium' : 'text-gray-400'}>
                {complianceStatus.soc2 ? '✓ Certified' : '○ Pending'}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="font-medium">GDPR Compliance</span>
              <span className={complianceStatus.gdpr ? 'text-green-600 font-medium' : 'text-gray-400'}>
                {complianceStatus.gdpr ? '✓ Compliant' : '○ Pending'}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="font-medium">ISO 27001</span>
              <span className={complianceStatus.iso27001 ? 'text-green-600 font-medium' : 'text-gray-400'}>
                {complianceStatus.iso27001 ? '✓ Certified' : '○ Pending'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Pending Access Reviews */}
      {pendingReviews.length > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-6">
          <h2 className="text-lg font-semibold text-yellow-900 mb-4">Pending Access Reviews</h2>
          <div className="space-y-3">
            {pendingReviews.map(review => (
              <div key={review.id} className="bg-white rounded-lg p-4 border border-yellow-200">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{review.userName}</p>
                    <p className="text-sm text-gray-600">
                      Requested role: {review.requestedRole} | {new Date(review.requestedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => approveRequest(review.id)}
                      className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => rejectRequest(review.id, 'Rejected by admin')}
                      className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
