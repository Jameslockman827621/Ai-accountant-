'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    const verify = async () => {
      if (!token) {
        setStatus('error');
        setMessage('Verification token is missing.');
        return;
      }

      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/auth/email/verify`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          }
        );
        const data = await response.json();
        if (!response.ok) {
          setStatus('error');
          setMessage(data?.error || 'Unable to verify email.');
          return;
        }
        setStatus('success');
        setMessage(data?.message || 'Email verified successfully.');
      } catch (error) {
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Unable to verify email.');
      }
    };

    void verify();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full rounded-2xl bg-white p-8 shadow-lg text-center space-y-4">
        <p className="text-sm uppercase tracking-wide text-blue-600">Email Verification</p>
        <h1 className="text-2xl font-semibold text-gray-900">
          {status === 'success' ? 'All set!' : status === 'error' ? 'Verification problem' : 'Verifying…'}
        </h1>
        <p className="text-gray-600">{message || 'Hold tight while we confirm your email.'}</p>
        <a
          href="/"
          className="inline-flex justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Return to login
        </a>
      </div>
    </div>
  );
}
