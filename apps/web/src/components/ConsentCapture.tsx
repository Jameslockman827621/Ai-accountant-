'use client';

import { useState } from 'react';

interface ConsentCaptureProps {
  token: string;
  consentType: 'banking' | 'tax_authority' | 'data_sharing' | 'marketing' | 'gdpr' | 'ccpa';
  consentScope?: string;
  provider?: string;
  onConsentGranted?: (consentId: string) => void;
  onConsentDenied?: () => void;
  required?: boolean;
}

interface ConsentText {
  title: string;
  description: string;
  details: string[];
  legalBasis?: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

const CONSENT_TEXTS: Record<string, ConsentText> = {
  banking: {
    title: 'Bank Account Access Consent',
    description:
      'To provide automatic transaction import and reconciliation, we need your consent to access your bank account data.',
    details: [
      'We will access your account balances and transaction history',
      'Access is read-only - we cannot initiate transactions',
      'Your credentials are encrypted and stored securely',
      'You can revoke this consent at any time',
      'Data is used solely for accounting and financial management',
    ],
    legalBasis: 'Contract - necessary for service delivery',
  },
  tax_authority: {
    title: 'Tax Authority Access Consent',
    description:
      'To submit tax filings on your behalf, we need your consent to access your tax authority account.',
    details: [
      'We will submit VAT, income tax, and other filings on your behalf',
      'You will review and approve all filings before submission',
      'We will access filing history and submission status',
      'You can revoke this consent at any time',
      'All submissions comply with tax authority regulations',
    ],
    legalBasis: 'Contract - necessary for service delivery',
  },
  data_sharing: {
    title: 'Data Sharing Consent',
    description:
      'To provide enhanced services, we may share anonymized data with trusted partners for analytics and service improvement.',
    details: [
      'Only anonymized, aggregated data is shared',
      'No personally identifiable information is shared',
      'Data is used for service improvement and analytics',
      'You can opt out at any time',
      'All partners are bound by strict data protection agreements',
    ],
    legalBasis: 'Consent - optional enhancement',
  },
  marketing: {
    title: 'Marketing Communications Consent',
    description:
      'Receive updates about new features, tax tips, and best practices to help you manage your finances better.',
    details: [
      'We will send you product updates and feature announcements',
      'You will receive tax tips and financial best practices',
      'You can unsubscribe at any time',
      'We respect your inbox - typically 1-2 emails per month',
      'You can customize your communication preferences',
    ],
    legalBasis: 'Consent - optional',
  },
  gdpr: {
    title: 'GDPR Data Processing Consent',
    description:
      'Under GDPR, we need your consent to process your personal data for accounting and financial services.',
    details: [
      'We process your data to provide accounting services',
      'Data is stored securely in EU-compliant data centers',
      'You have the right to access, rectify, or delete your data',
      'You can withdraw consent at any time',
      'We will not process your data for purposes other than accounting',
    ],
    legalBasis: 'Consent - GDPR requirement',
  },
  ccpa: {
    title: 'CCPA Privacy Rights',
    description:
      'Under CCPA, you have specific rights regarding your personal information. Please review and acknowledge.',
    details: [
      'You have the right to know what personal information we collect',
      'You have the right to delete your personal information',
      'You have the right to opt-out of the sale of personal information',
      'We do not sell your personal information',
      'You can exercise these rights at any time',
    ],
  },
};

export default function ConsentCapture({
  token,
  consentType,
  consentScope,
  provider,
  onConsentGranted,
  onConsentDenied,
  required = false,
}: ConsentCaptureProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRead, setHasRead] = useState(false);

  const consentText = CONSENT_TEXTS[consentType] || {
    title: 'Consent Required',
    description: 'Please review and accept the terms.',
    details: [],
  };

  const handleConsent = async (granted: boolean) => {
    if (!granted && required) {
      setError('This consent is required to continue');
      return;
    }

    if (!granted) {
      onConsentDenied?.();
      return;
    }

    if (!hasRead) {
      setError('Please read the consent details before accepting');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/consent`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          consentType,
          consentScope,
          provider,
          consentText: JSON.stringify(consentText),
          consentMethod: 'web_form',
          gdprBasis: consentText.legalBasis,
          ccpaOptOut: !granted && consentType === 'ccpa',
          dataUsageStatement: consentText.description,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to record consent');
      }

      const data = await response.json();
      onConsentGranted?.(data.consentId);
    } catch (error) {
      console.error('Consent recording failed', error);
      setError('Failed to record consent. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{consentText.title}</h3>
        <p className="text-sm text-gray-600">{consentText.description}</p>
        {required && (
          <span className="inline-block mt-2 px-2 py-1 text-xs font-medium text-orange-600 bg-orange-50 rounded">
            Required
          </span>
        )}
      </div>

      <div className="rounded-lg bg-gray-50 p-4 space-y-3">
        <h4 className="font-medium text-gray-900 text-sm">What this means:</h4>
        <ul className="space-y-2">
          {consentText.details.map((detail, index) => (
            <li key={index} className="flex items-start space-x-2 text-sm text-gray-700">
              <span className="text-blue-600 mt-0.5">•</span>
              <span>{detail}</span>
            </li>
          ))}
        </ul>
      </div>

      {consentText.legalBasis && (
        <div className="rounded-lg bg-blue-50 p-3">
          <p className="text-xs text-blue-800">
            <strong>Legal Basis:</strong> {consentText.legalBasis}
          </p>
        </div>
      )}

      <div className="flex items-start space-x-3">
        <input
          type="checkbox"
          id="hasRead"
          checked={hasRead}
          onChange={(e) => setHasRead(e.target.checked)}
          className="mt-1"
        />
        <label htmlFor="hasRead" className="text-sm text-gray-700">
          I have read and understand the consent details above
        </label>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex space-x-3">
        <button
          onClick={() => handleConsent(true)}
          disabled={isSubmitting || !hasRead}
          className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Processing...' : 'I Consent'}
        </button>
        {!required && (
          <button
            onClick={() => handleConsent(false)}
            disabled={isSubmitting}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Decline
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500">
        You can revoke this consent at any time from your account settings. For more information,
        see our{' '}
        <a href="/privacy" className="text-blue-600 hover:text-blue-700 underline">
          Privacy Policy
        </a>
        .
      </p>
    </div>
  );
}
