'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const APP_URL = (
  (typeof window !== 'undefined' && window.location.origin) ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:3000'
) as string;

type Provider = 'plaid' | 'truelayer';

interface ConnectionRow {
  id: string;
  provider: Provider;
  status: string;
  metadata: Record<string, any>;
  lastSync: string | null;
  lastSuccess: string | null;
  nextSync: string | null;
  lastRefreshedAt: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  exceptionCount: number;
  errorCount: number;
}

interface BankConnectionsPanelProps {
  token: string;
  variant?: 'dashboard' | 'onboarding';
}

function PlaidLinkLauncher({
  token,
  onSuccess,
  onExit,
}: {
  token: string;
  onSuccess: (publicToken: string, metadata: any) => void;
  onExit: () => void;
}) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess,
    onExit,
  });

  useEffect(() => {
    if (ready) {
      open();
    }
  }, [ready, open]);

  return null;
}

export default function BankConnectionsPanel({ token, variant = 'dashboard' }: BankConnectionsPanelProps) {
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [plaidLinkToken, setPlaidLinkToken] = useState<string | null>(null);
  const [accountSelections, setAccountSelections] = useState<Record<string, string>>({});
  const [csvAccountId, setCsvAccountId] = useState('');
  const [csvContent, setCsvContent] = useState('');
  const [csvUploading, setCsvUploading] = useState(false);

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }),
    [token]
  );

  const variantClasses = variant === 'onboarding' ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200 bg-white';

  const refreshConnections = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE}/api/bank-feed/connections`, {
        headers: authHeaders,
      });
      if (!response.ok) {
        throw new Error('Unable to load bank connections');
      }
      const data = (await response.json()) as { connections: ConnectionRow[] };
      setConnections(data.connections);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load bank connections');
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    refreshConnections().catch(() => null);
  }, [refreshConnections]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      try {
        const expectedOrigin = new URL(APP_URL).origin;
        if (event.origin !== expectedOrigin) {
          return;
        }
      } catch {
        // ignore origin issues
      }
      if (event.data?.type === 'truelayer-connection') {
        if (event.data.status === 'success') {
          setMessage('TrueLayer bank connection created.');
          refreshConnections().catch(() => null);
        } else if (event.data.status === 'error') {
          setError(event.data.message || 'TrueLayer connection failed.');
        }
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handlePlaidSuccess = async (publicToken: string, metadata: any) => {
    try {
      setMessage('Finalising Plaid connection…');
      const response = await fetch(`${API_BASE}/api/bank-feed/plaid/exchange-token`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          publicToken,
          institution: metadata?.institution || null,
          accounts: metadata?.accounts || null,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Plaid exchange failed');
      }
      setMessage('Plaid bank connection added.');
      refreshConnections().catch(() => null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to exchange Plaid token');
    } finally {
      setPlaidLinkToken(null);
    }
  };

  const connectWithPlaid = async () => {
    try {
      setError(null);
      const response = await fetch(`${API_BASE}/api/bank-feed/plaid/link-token`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (!response.ok) {
        throw new Error('Unable to create Plaid session');
      }
      const data = await response.json();
      setPlaidLinkToken(data.linkToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start Plaid link');
    }
  };

  const connectWithTrueLayer = async () => {
    try {
      setError(null);
      const redirectUri = `${APP_URL.replace(/\/$/, '')}/bank/truelayer/callback`;
      const response = await fetch(`${API_BASE}/api/bank-feed/truelayer/auth-link`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ redirectUri }),
      });
      if (!response.ok) {
        throw new Error('Unable to start TrueLayer flow');
      }
      const data = await response.json();
      window.localStorage.setItem('truelayer_oauth_state', data.state);
      const popup = window.open(data.authUrl, 'truelayer-connect', 'width=520,height=720,noopener,noreferrer');
      if (!popup) {
        window.location.href = data.authUrl;
      } else {
        popup.focus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start TrueLayer flow');
    }
  };

  const disconnectConnection = async (connectionId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/bank-feed/connections/${connectionId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Unable to disconnect connection');
      }
      setMessage('Connection disconnected');
      refreshConnections().catch(() => null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to disconnect connection');
    }
  };

  const syncConnection = async (connection: ConnectionRow) => {
    try {
      setMessage('Sync in progress…');
      setError(null);
      const body: Record<string, unknown> = {};
      if (connection.provider === 'truelayer') {
        const selection = accountSelections[connection.id];
        const accounts = (connection.metadata?.accounts as Array<{ account_id: string; display_name?: string }> | undefined) || [];
        body.accountId = selection || accounts[0]?.account_id;
        if (!body.accountId) {
          throw new Error('Select an account to sync');
        }
      }

      const response = await fetch(`${API_BASE}/api/bank-feed/connections/${connection.id}/sync`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Unable to sync connection');
      }
      setMessage(data?.message || 'Sync complete');
      refreshConnections().catch(() => null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sync connection');
    }
  };

  const handleCsvUpload = async () => {
    if (!csvAccountId || !csvContent) {
      setError('Provide an account ID and CSV contents.');
      return;
    }
    try {
      setCsvUploading(true);
      const response = await fetch(`${API_BASE}/api/bank-feed/import/csv`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ accountId: csvAccountId, csvContent }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to import CSV');
      }
      setMessage(data?.message || 'CSV imported');
      setCsvAccountId('');
      setCsvContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import CSV');
    } finally {
      setCsvUploading(false);
    }
  };

  const handleCsvFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvContent(text);
  };

  const connectionDisplayName = (connection: ConnectionRow) => {
    const metadata = connection.metadata || {};
    const institution = metadata?.institution as { name?: string } | undefined;
    if (institution?.name) {
      return institution.name;
    }
    const accounts = metadata?.accounts as Array<{ display_name?: string }> | undefined;
    return accounts?.[0]?.display_name || connection.provider;
  };

  const allowCsv = variant !== 'onboarding';

  return (
    <section className={`rounded-2xl border ${variantClasses} p-6 shadow-sm space-y-4`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Bank connections</h3>
          <p className="text-sm text-gray-500">
            Connect live feeds to reconcile bank, ledger, and filings in real time.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={connectWithPlaid}
            className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
          >
            Connect with Plaid
          </button>
          <button
            type="button"
            onClick={connectWithTrueLayer}
            className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
          >
            Connect with TrueLayer
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{message}</div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading connections…</p>
      ) : connections.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
          No bank feeds connected yet. Add one above to unlock automated reconciliation.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Institution</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Last sync</th>
                <th className="px-3 py-2">Next sync</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
                {connections.map(connection => {
                  const accounts =
                    (connection.metadata?.accounts as Array<{ account_id: string; display_name?: string }> | undefined) || [];
                  const hasAccounts = accounts.length > 0;
                  const defaultAccountId = hasAccounts ? accounts[0]!.account_id : '';
                const statusColor =
                  connection.status === 'healthy'
                    ? 'bg-green-100 text-green-800'
                    : connection.status === 'expired'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-amber-100 text-amber-800';
                return (
                  <tr key={connection.id} className="text-gray-700">
                    <td className="px-3 py-3 font-medium">{connectionDisplayName(connection)}</td>
                    <td className="px-3 py-3 capitalize">{connection.provider}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColor}`}>
                        {connection.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {connection.lastSync ? new Date(connection.lastSync).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-3 py-3">
                      {connection.nextSync ? new Date(connection.nextSync).toLocaleString() : 'Queued'}
                    </td>
                    <td className="px-3 py-3 space-y-2">
                        {connection.provider === 'truelayer' && hasAccounts && (
                        <select
                          className="w-full rounded border px-2 py-1 text-xs"
                            value={accountSelections[connection.id] ?? defaultAccountId}
                          onChange={e =>
                            setAccountSelections(prev => ({
                              ...prev,
                              [connection.id]: e.target.value,
                            }))
                          }
                        >
                          {accounts.map(account => (
                            <option key={account.account_id} value={account.account_id}>
                              {account.display_name || account.account_id}
                            </option>
                          ))}
                        </select>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => syncConnection(connection)}
                          className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Sync now
                        </button>
                        <button
                          type="button"
                          onClick={() => disconnectConnection(connection.id)}
                          className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Disconnect
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {allowCsv && (
        <div className="rounded-lg border border-dashed border-gray-300 p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-800">Manual CSV import</p>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              type="text"
              className="rounded border px-3 py-2 text-sm"
              placeholder="Bank account ID"
              value={csvAccountId}
              onChange={e => setCsvAccountId(e.target.value)}
            />
            <input type="file" accept=".csv" onChange={handleCsvFile} className="text-sm" />
          </div>
          <textarea
            className="mt-2 w-full rounded border px-3 py-2 text-sm"
            placeholder="Or paste CSV contents here…"
            rows={4}
            value={csvContent}
            onChange={e => setCsvContent(e.target.value)}
          />
          <button
            type="button"
            onClick={handleCsvUpload}
            disabled={csvUploading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {csvUploading ? 'Importing…' : 'Import CSV'}
          </button>
        </div>
      )}

      {plaidLinkToken && (
        <PlaidLinkLauncher
          token={plaidLinkToken}
          onSuccess={handlePlaidSuccess}
          onExit={() => {
            setPlaidLinkToken(null);
          }}
        />
      )}
    </section>
  );
}
