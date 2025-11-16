'use client';

import React, { useState } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('EmailForwardingWizard');

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface EmailForwardingWizardProps {
  token: string;
  onComplete?: () => void;
}

/**
 * Setup Wizard for Email Forwarding (Chunk 1)
 */
export default function EmailForwardingWizard({ token, onComplete }: EmailForwardingWizardProps) {
  const [step, setStep] = useState(1);
  const [aliasEmail, setAliasEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const createAlias = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/ingestion/email/aliases`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresInDays: 365 }),
      });

      if (res.ok) {
        const data = await res.json();
        setAliasEmail(data.alias.aliasEmail);
        setStep(2);
      }
    } catch (error) {
      logger.error('Failed to create email alias', error);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Email Forwarding Setup</h2>

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-gray-600">
            Create a unique email address to forward documents to. All attachments will be automatically processed.
          </p>
          <button
            onClick={createAlias}
            disabled={loading}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Email Alias'}
          </button>
        </div>
      )}

      {step === 2 && aliasEmail && (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-green-800 font-medium mb-2">Email alias created successfully!</p>
            <div className="flex items-center space-x-2">
              <code className="flex-1 bg-white px-3 py-2 rounded border border-green-200 text-sm">
                {aliasEmail}
              </code>
              <button
                onClick={() => copyToClipboard(aliasEmail)}
                className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Copy
              </button>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="font-semibold text-gray-900 mb-2">Next Steps:</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
              <li>Copy the email address above</li>
              <li>Configure your email client to forward documents to this address</li>
              <li>Documents will be automatically processed when received</li>
            </ol>
          </div>

          {onComplete && (
            <button
              onClick={onComplete}
              className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Done
            </button>
          )}
        </div>
      )}
    </div>
  );
}
