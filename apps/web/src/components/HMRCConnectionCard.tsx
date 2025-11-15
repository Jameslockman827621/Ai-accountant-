'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface HMRCStatusResponse {
  status: {
    connected: boolean;
    vrn?: string | null;
    scopes?: string[];
    expiresAt?: string | null;
    consentExpiresAt?: string | null;
  };
}

interface HMRCConnectionCardProps {
  token: string;
}

export default function HMRCConnectionCard({ token }: HMRCConnectionCardProps) {
  const [status, setStatus] = useState<HMRCStatusResponse['status'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vrn, setVrn] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const callbackUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return `${window.location.origin}/integrations/hmrc/callback`;
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE}/api/integrations/hmrc/status`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HMRC status request failed: ${response.status}`);
      }

      const data = (await response.json()) as HMRCStatusResponse;
      setStatus(data.status);
      if (data.status.connected && data.status.vrn) {
        setVrn(data.status.vrn);
      }
    } catch (err) {
      console.error('Failed to fetch HMRC status', err);
      setError('Unable to load HMRC connection status.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchStatus();
    }
  }, [token, fetchStatus]);

  const handleConnect = async () => {
    try {
      if (!callbackUrl) {
        setError('Unable to determine callback URL in this environment.');
        return;
      }

      setError(null);
      setActionMessage('Redirecting to HMRC…');

      const response = await fetch(
        `${API_BASE}/api/integrations/hmrc/authorize?redirectUri=${encodeURIComponent(callbackUrl)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Authorize request failed: ${response.status}`);
      }

      const data = (await response.json()) as { authorizeUrl: string; state: string };
      sessionStorage.setItem('hmrc_oauth_state', data.state);
      if (vrn) {
        sessionStorage.setItem('hmrc_vrn', vrn);
      } else {
        sessionStorage.removeItem('hmrc_vrn');
      }

      window.location.href = data.authorizeUrl;
    } catch (err) {
      console.error('HMRC connect failed', err);
      setError('Unable to start HMRC authorization flow.');
      setActionMessage(null);
    }
  };

  const handleDisconnect = async () => {
    try {
      setActionMessage('Disconnecting…');
      const response = await fetch(`${API_BASE}/api/integrations/hmrc/disconnect`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Disconnect failed: ${response.status}`);
      }

      await fetchStatus();
      setActionMessage(null);
    } catch (err) {
      console.error('HMRC disconnect failed', err);
      setError('Unable to disconnect HMRC right now.');
      setActionMessage(null);
    }
  };

  const handleRefresh = async () => {
    try {
      setActionMessage('Refreshing token…');
      const response = await fetch(`${API_BASE}/api/integrations/hmrc/refresh`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Refresh failed: ${response.status}`);
      }

      await fetchStatus();
      setActionMessage('Token refreshed');
      setTimeout(() => setActionMessage(null), 2000);
    } catch (err) {
      console.error('HMRC refresh failed', err);
      setError('Unable to refresh HMRC token.');
      setActionMessage(null);
    }
  };

  return (
    <section className="bg-white rounded-lg shadow p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold">HMRC VAT Connection</h2>
          <p className="text-sm text-gray-500">Manage Making Tax Digital access</p>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-medium ${
            status?.connected ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {status?.connected ? 'Connected' : 'Not Connected'}
        </span>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading HMRC status…</p>
      ) : (
        <>
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

          <div className="space-y-3 text-sm flex-1">
            <div>
              <label className="block text-gray-600 mb-1">VAT Registration Number (VRN)</label>
              <input
                type="text"
                value={vrn}
                onChange={(e) => setVrn(e.target.value.toUpperCase())}
                placeholder="GB123456789"
                className="w-full border rounded px-3 py-2 focus:outline-none focus:ring"
              />
            </div>

            {status?.expiresAt && (
              <p className="text-gray-600">
                Access token expires:{' '}
                <strong>{new Date(status.expiresAt).toLocaleString('en-GB')}</strong>
              </p>
            )}
            {status?.consentExpiresAt && (
              <p className="text-gray-600">
                Consent valid until{' '}
                <strong>{new Date(status.consentExpiresAt).toLocaleDateString('en-GB')}</strong>
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={handleConnect}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              disabled={loading || !callbackUrl}
            >
              {status?.connected ? 'Reconnect HMRC' : 'Connect HMRC'}
            </button>
            {status?.connected && (
              <>
                <button
                  onClick={handleRefresh}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100"
                >
                  Refresh Token
                </button>
                <button
                  onClick={handleDisconnect}
                  className="px-4 py-2 border border-red-300 text-red-700 rounded hover:bg-red-50"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>

          {actionMessage && (
            <p className="text-xs text-gray-500 mt-2">{actionMessage}</p>
          )}
        </>
      )}
    </section>
  );
}
