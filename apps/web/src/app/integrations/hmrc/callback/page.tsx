'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function HMRCCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token } = useAuth();
  const [status, setStatus] = useState<'pending' | 'error' | 'success'>('pending');
  const [message, setMessage] = useState('Finalizing HMRC connection…');

  const redirectUri = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return `${window.location.origin}/integrations/hmrc/callback`;
  }, []);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!token) {
      setStatus('error');
      setMessage('You need to sign in before connecting HMRC.');
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setMessage('Missing HMRC authorization parameters.');
      return;
    }

    if (!redirectUri) {
      setStatus('error');
      setMessage('Unable to resolve callback URL.');
      return;
    }

    const expectedState = sessionStorage.getItem('hmrc_oauth_state');
    if (expectedState && expectedState !== state) {
      setStatus('error');
      setMessage('State mismatch detected. Please retry the HMRC connection.');
      return;
    }

    const vrn = sessionStorage.getItem('hmrc_vrn') || undefined;

    async function finalizeConnection() {
      try {
        const response = await fetch(`${API_BASE}/api/integrations/hmrc/connect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            authorizationCode: code,
            redirectUri,
            state,
            vrn,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || `Connect failed with status ${response.status}`);
        }

        sessionStorage.removeItem('hmrc_oauth_state');
        sessionStorage.removeItem('hmrc_vrn');

        setStatus('success');
        setMessage('HMRC connected successfully. Redirecting…');
        setTimeout(() => router.push('/'), 2000);
      } catch (err) {
        console.error('HMRC callback error', err);
        setStatus('error');
        setMessage(
          err instanceof Error ? err.message : 'Unable to complete HMRC connection. Please try again.'
        );
      }
    }

    void finalizeConnection();
  }, [redirectUri, router, searchParams, token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white shadow rounded-lg p-8 max-w-md w-full text-center space-y-4">
        <h1 className="text-2xl font-semibold">HMRC Authorization</h1>
        <p className="text-gray-600">{message}</p>
        {status === 'error' && (
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Return to Dashboard
          </button>
        )}
        {status === 'pending' && <p className="text-sm text-gray-500">This may take a few seconds…</p>}
      </div>
    </div>
  );
}
