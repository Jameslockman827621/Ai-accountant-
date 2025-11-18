'use client';

import { FormEvent, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams?.get('token') ?? null;
  const { resetPassword } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError('Reset token is missing.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      await resetPassword(token, password);
      setStatus('Password updated. You can now sign in with your new password.');
      setTimeout(() => router.push('/'), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl bg-white p-8 shadow-lg">
        <div className="text-center space-y-2">
          <p className="text-sm uppercase tracking-wide text-blue-600">Reset Password</p>
          <h1 className="text-2xl font-semibold text-gray-900">Choose a new password</h1>
          <p className="text-sm text-gray-500">Use at least 12 characters with a mix of letters, numbers, and symbols.</p>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {status && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{status}</div>
        )}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <input
            type="password"
            required
            className="w-full rounded-lg border px-3 py-2"
            placeholder="New password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <input
            type="password"
            required
            className="w-full rounded-lg border px-3 py-2"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>

        <a href="/" className="block text-center text-sm text-gray-600 underline">
          Back to login
        </a>
      </div>
    </div>
  );
}
