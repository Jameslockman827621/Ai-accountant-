'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export default function TrueLayerCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing bank connection…');

  useEffect(() => {
    if (!searchParams) {
      setStatus('error');
      setMessage('Missing callback parameters.');
      return;
    }

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (errorParam) {
      setStatus('error');
      setMessage(errorDescription || 'TrueLayer reported an error.');
      window.opener?.postMessage(
        { type: 'truelayer-connection', status: 'error', message: errorDescription || errorParam },
        new URL(APP_URL).origin
      );
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setMessage('Missing authorization code or state.');
      return;
    }

    const storedState = window.localStorage.getItem('truelayer_oauth_state');
    if (!storedState || storedState !== state) {
      setStatus('error');
      setMessage('State mismatch. Please restart the bank linking flow.');
      return;
    }

    const token = window.localStorage.getItem('auth_token');
    if (!token) {
      setStatus('error');
      setMessage('Missing auth session. Please log in and retry.');
      return;
    }

    const redirectUri = `${APP_URL.replace(/\/$/, '')}/bank/truelayer/callback`;

    const finish = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/bank-feed/truelayer/exchange`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code, redirectUri }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'Unable to exchange TrueLayer code');
        }
        setStatus('success');
        setMessage('Bank connection established. You can close this window.');
        window.localStorage.removeItem('truelayer_oauth_state');
        window.opener?.postMessage({ type: 'truelayer-connection', status: 'success' }, new URL(APP_URL).origin);
        setTimeout(() => window.close(), 1500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to exchange TrueLayer code';
        setStatus('error');
        setMessage(msg);
        window.opener?.postMessage({ type: 'truelayer-connection', status: 'error', message: msg }, new URL(APP_URL).origin);
      }
    };

    finish().catch(() => undefined);
  }, [searchParams]);

  const heading =
    status === 'loading' ? 'Connecting to your bank…' : status === 'success' ? 'All done!' : 'Something went wrong';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">{heading}</h1>
        <p className="mt-3 text-sm text-slate-600">{message}</p>
        {status === 'success' && (
          <button
            type="button"
            onClick={() => router.push('/')}
            className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Return to dashboard
          </button>
        )}
        {status === 'error' && (
          <button
            type="button"
            onClick={() => router.push('/')}
            className="mt-6 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Retry from dashboard
          </button>
        )}
      </div>
    </div>
  );
}
