'use client';

import { useState } from 'react';
import QRCode from 'qrcode';

interface AccountSecurityPanelProps {
  token: string;
  email: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  onRefresh: () => void;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function AccountSecurityPanel({ token, email, emailVerified, mfaEnabled, onRefresh }: AccountSecurityPanelProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [disableCode, setDisableCode] = useState('');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const handleResendVerification = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
        const response = await fetch(`${API_BASE}/api/auth/email/resend`, {
        method: 'POST',
        headers,
          body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error || 'Unable to resend email');
      }
      setMessage('Verification email sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resend verification email');
    } finally {
      setLoading(false);
    }
  };

  const startMfaSetup = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/auth/mfa/setup`, {
        method: 'POST',
        headers,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Unable to start MFA setup');
      }
      setSetupSecret({ secret: data.secret, otpauthUrl: data.otpauthUrl });
      const qr = await QRCode.toDataURL(data.otpauthUrl);
      setQrDataUrl(qr);
      setMessage('Scan the QR code with your authenticator app, then enter the 6-digit code.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start MFA setup');
    } finally {
      setLoading(false);
    }
  };

  const confirmMfa = async () => {
    if (!mfaCode) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/auth/mfa/enable`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: mfaCode }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Unable to enable MFA');
      }
      setMessage('Multi-factor authentication enabled.');
      setSetupSecret(null);
      setQrDataUrl(null);
      setMfaCode('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to enable MFA');
    } finally {
      setLoading(false);
    }
  };

  const disableMfa = async () => {
    if (!disableCode) {
      setError('Enter your authenticator code to disable MFA.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/auth/mfa/disable`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: disableCode }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Unable to disable MFA');
      }
      setMessage('Multi-factor authentication disabled.');
      setDisableCode('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to disable MFA');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-xl bg-white p-6 shadow space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Account security</h2>
        <p className="text-sm text-gray-500">Manage verification status, multi-factor authentication, and alerts.</p>
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{message}</div>}

      <div className="space-y-2 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-900">Email verification</p>
            <p className="text-sm text-gray-500">
              {emailVerified ? 'Email confirmed.' : 'Email not verified. We cannot send filings without confirmation.'}
            </p>
          </div>
          {emailVerified ? (
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">Verified</span>
          ) : (
            <button
              type="button"
              className="rounded-lg border border-blue-300 px-3 py-1 text-sm text-blue-700 hover:bg-blue-50"
              onClick={handleResendVerification}
              disabled={loading}
            >
              Resend email
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-900">Multi-factor authentication</p>
            <p className="text-sm text-gray-500">
              Add an extra layer of protection by requiring an authenticator app code on every login.
            </p>
          </div>
          {mfaEnabled ? (
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">Enabled</span>
          ) : (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">Disabled</span>
          )}
        </div>

        {!mfaEnabled && !setupSecret && (
          <button
            type="button"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            onClick={startMfaSetup}
            disabled={loading}
          >
            {loading ? 'Preparing…' : 'Enable multi-factor authentication'}
          </button>
        )}

        {!mfaEnabled && setupSecret && (
          <div className="space-y-3">
            {qrDataUrl && <img src={qrDataUrl} alt="Scan QR code" className="mx-auto h-40 w-40" />}
            <p className="text-sm text-gray-500">
              If you can’t scan the QR code, enter this secret manually: <span className="font-mono">{setupSecret.secret}</span>
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                className="flex-1 rounded-lg border px-3 py-2"
                placeholder="6-digit code"
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value)}
              />
              <button
                type="button"
                className="rounded-lg bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
                onClick={confirmMfa}
                disabled={loading}
              >
                Confirm
              </button>
            </div>
          </div>
        )}

        {mfaEnabled && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Enter a current code to disable MFA.</p>
            <div className="flex gap-3">
              <input
                type="text"
                className="flex-1 rounded-lg border px-3 py-2"
                placeholder="6-digit code"
                value={disableCode}
                onChange={e => setDisableCode(e.target.value)}
              />
              <button
                type="button"
                className="rounded-lg border border-red-300 px-4 py-2 text-red-700 hover:bg-red-50 disabled:opacity-60"
                onClick={disableMfa}
                disabled={loading}
              >
                Disable MFA
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
