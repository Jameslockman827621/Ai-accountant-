'use client';

import { useState, useEffect } from 'react';

interface KYCVerificationProps {
  token: string;
  tenantId: string;
  onComplete?: (verificationId: string) => void;
  onError?: (error: string) => void;
}

type KYCStatus = 'pending' | 'in_progress' | 'approved' | 'rejected' | 'expired' | 'requires_review';
type VerificationType = 'identity' | 'business' | 'address' | 'document' | 'comprehensive';

interface Verification {
  id: string;
  status: KYCStatus;
  verificationType: VerificationType;
  provider?: string;
  requiresManualReview: boolean;
  expiresAt?: Date;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function KYCVerification({ token, tenantId, onComplete, onError }: KYCVerificationProps) {
  const [verificationType, setVerificationType] = useState<VerificationType>('identity');
  const [documentType, setDocumentType] = useState<string>('passport');
  const [isUploading, setIsUploading] = useState(false);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [uploadedDocuments, setUploadedDocuments] = useState<string[]>([]);

  useEffect(() => {
    // Load existing verifications
    loadVerifications();
  }, [tenantId]);

  const loadVerifications = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/kyc`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const existing = data.verifications?.find((v: Verification) => 
          v.verificationType === verificationType && v.status === 'approved'
        );
        if (existing) {
          setVerification(existing);
        }
      }
    } catch (error) {
      console.error('Failed to load verifications', error);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const documentIds: string[] = [];

    try {
      // Upload documents (in production, this would upload to document service)
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);

        const uploadResponse = await fetch(`${API_BASE}/api/documents/upload`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        if (uploadResponse.ok) {
          const uploadData = await uploadResponse.json();
          documentIds.push(uploadData.documentId);
        }
      }

      setUploadedDocuments(documentIds);
    } catch (error) {
      console.error('File upload failed', error);
      onError?.('Failed to upload documents');
    } finally {
      setIsUploading(false);
    }
  };

  const initiateVerification = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/kyc/verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          verificationType,
          documentType,
          documentReferences: uploadedDocuments,
          provider: 'internal', // In production, could be 'persona' or 'onfido'
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to initiate verification');
      }

      const data = await response.json();
      setVerification({
        id: data.verificationId,
        status: 'pending',
        verificationType,
        requiresManualReview: false,
      });

      // Poll for status updates
      pollVerificationStatus(data.verificationId);
    } catch (error) {
      console.error('Verification initiation failed', error);
      onError?.('Failed to start verification');
    }
  };

  const pollVerificationStatus = async (verificationId: string) => {
    const maxAttempts = 30;
    let attempts = 0;

    const poll = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/kyc/verify/${verificationId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          const updatedVerification = data.verification as Verification;
          setVerification(updatedVerification);

          if (updatedVerification.status === 'approved') {
            onComplete?.(verificationId);
          } else if (updatedVerification.status === 'rejected') {
            onError?.('Verification was rejected. Please try again.');
          } else if (attempts < maxAttempts && updatedVerification.status === 'pending') {
            setTimeout(poll, 2000);
            attempts++;
          }
        }
      } catch (error) {
        console.error('Status poll failed', error);
      }
    };

    poll();
  };

  const getStatusColor = (status: KYCStatus) => {
    switch (status) {
      case 'approved':
        return 'text-green-600 bg-green-50';
      case 'rejected':
        return 'text-red-600 bg-red-50';
      case 'in_progress':
      case 'requires_review':
        return 'text-yellow-600 bg-yellow-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const getStatusMessage = (status: KYCStatus) => {
    switch (status) {
      case 'approved':
        return '✅ Verification approved';
      case 'rejected':
        return '❌ Verification rejected';
      case 'in_progress':
        return '⏳ Verification in progress';
      case 'requires_review':
        return '📋 Manual review required';
      default:
        return '⏸️ Pending verification';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Identity Verification</h3>
        <p className="text-sm text-gray-600">
          We need to verify your identity to comply with regulations and ensure account security.
        </p>
      </div>

      {verification && verification.status === 'approved' ? (
        <div className={`rounded-lg p-4 ${getStatusColor(verification.status)}`}>
          <p className="font-medium">{getStatusMessage(verification.status)}</p>
          <p className="text-sm mt-1">
            Your verification was approved on {new Date().toLocaleDateString()}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Verification Type
              </label>
              <select
                value={verificationType}
                onChange={(e) => setVerificationType(e.target.value as VerificationType)}
                className="w-full rounded border border-gray-300 px-3 py-2"
                disabled={!!verification}
              >
                <option value="identity">Identity Verification</option>
                <option value="business">Business Verification</option>
                <option value="comprehensive">Comprehensive Verification</option>
              </select>
            </div>

            {verificationType === 'identity' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Document Type
                </label>
                <select
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                  disabled={!!verification}
                >
                  <option value="passport">Passport</option>
                  <option value="driving_license">Driving License</option>
                  <option value="national_id">National ID</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Upload Documents
              </label>
              <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-lg">
                <div className="space-y-1 text-center">
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400"
                    stroke="currentColor"
                    fill="none"
                    viewBox="0 0 48 48"
                  >
                    <path
                      d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div className="flex text-sm text-gray-600">
                    <label className="relative cursor-pointer rounded-md font-medium text-blue-600 hover:text-blue-500">
                      <span>Upload files</span>
                      <input
                        type="file"
                        className="sr-only"
                        multiple
                        accept="image/*,.pdf"
                        onChange={handleFileUpload}
                        disabled={isUploading || !!verification}
                      />
                    </label>
                    <p className="pl-1">or drag and drop</p>
                  </div>
                  <p className="text-xs text-gray-500">PNG, JPG, PDF up to 10MB</p>
                </div>
              </div>
              {uploadedDocuments.length > 0 && (
                <p className="mt-2 text-sm text-green-600">
                  {uploadedDocuments.length} document(s) uploaded
                </p>
              )}
            </div>

            {verification && (
              <div className={`rounded-lg p-4 ${getStatusColor(verification.status)}`}>
                <p className="font-medium">{getStatusMessage(verification.status)}</p>
                {verification.status === 'in_progress' && (
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{ width: '60%' }}></div>
                    </div>
                    <p className="text-xs mt-1">Processing your documents...</p>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={initiateVerification}
              disabled={isUploading || uploadedDocuments.length === 0 || !!verification}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? 'Uploading...' : verification ? 'Verification Started' : 'Start Verification'}
            </button>
          </div>

          <div className="rounded-lg bg-blue-50 p-4">
            <p className="text-sm text-blue-800">
              <strong>Why we need this:</strong> Identity verification helps us comply with financial regulations
              and protect your account from fraud. Your documents are encrypted and stored securely.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
