'use client';

import { useState } from 'react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useAuth, LoginResult } from '@/hooks/useAuth';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

function AuthCard({ googleEnabled }: { googleEnabled: boolean }) {
  const {
    login,
    verifyMfa,
    register,
    resendVerification,
    requestPasswordReset,
    loginWithGoogle,
  } = useAuth();

  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'mfa'>('login');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [form, setForm] = useState({
    loginEmail: '',
    loginPassword: '',
    name: '',
    tenantName: '',
    country: 'GB',
    registerEmail: '',
    registerPassword: '',
    googleTenantName: '',
    googleCountry: 'GB',
    mfaCode: '',
  });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const updateForm = (key: keyof typeof form, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleLoginResponse = (result: LoginResult) => {
    if (result.status === 'success') {
      setStatus('Welcome back! Redirecting to your dashboard…');
      setError(null);
    } else if (result.status === 'mfa_required') {
      setChallengeToken(result.challengeToken || null);
      setMode('mfa');
      setStatus('Enter the 6-digit code from your authenticator app.');
      setError(null);
    } else if (result.status === 'verification_required') {
      setStatus(result.message);
      setError(null);
    } else {
      setError(result.message);
      setStatus(null);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const result = await login(form.loginEmail, form.loginPassword);
    handleLoginResponse(result);
    setLoading(false);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await register({
        email: form.registerEmail,
        password: form.registerPassword,
        name: form.name,
        tenantName: form.tenantName,
        country: form.country,
      });
      setStatus(response.message);
      setMode('login');
      updateForm('loginEmail', form.registerEmail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await requestPasswordReset(form.loginEmail);
      setStatus('If the account exists, we sent password reset instructions.');
      setMode('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send reset link');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeToken) {
      setError('Missing MFA challenge token.');
      return;
    }
    setLoading(true);
    const result = await verifyMfa(challengeToken, form.mfaCode);
    handleLoginResponse(result);
    if (result.status === 'success') {
      setMode('login');
      setChallengeToken(null);
    }
    setLoading(false);
  };

  const handleResendVerification = async () => {
    try {
      await resendVerification(form.loginEmail);
      setStatus('Verification email sent (if the account exists).');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resend verification email');
    }
  };

    const handleGoogleSuccess = async (credential?: string) => {
      if (!credential) {
        setError('Google did not return an identity token.');
        return;
      }
      setLoading(true);
      const googleOptions: { tenantName?: string; country?: string } = {};
      if (form.googleTenantName) {
        googleOptions.tenantName = form.googleTenantName;
      }
      if (form.googleCountry) {
        googleOptions.country = form.googleCountry;
      }
      const result = await loginWithGoogle(credential, googleOptions);
      handleLoginResponse(result);
      setLoading(false);
    };

  const renderLogin = () => (
    <form className="space-y-5" onSubmit={handleLogin}>
      <div className="space-y-4">
        <div>
          <label className="sr-only" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            required
            className="w-full rounded-lg border px-3 py-2"
            placeholder="you@company.com"
            value={form.loginEmail}
            onChange={e => updateForm('loginEmail', e.target.value)}
          />
        </div>
        <div>
          <label className="sr-only" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            required
            className="w-full rounded-lg border px-3 py-2"
            placeholder="Password"
            value={form.loginPassword}
            onChange={e => updateForm('loginPassword', e.target.value)}
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
      <div className="flex items-center justify-between text-sm text-gray-600">
        <button type="button" onClick={() => setMode('register')} className="underline">
          Create an account
        </button>
        <button type="button" onClick={() => setMode('forgot')} className="underline">
          Forgot password?
        </button>
      </div>
      <div className="text-center">
        <button
          type="button"
          className="text-xs text-blue-600 underline disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleResendVerification}
          disabled={!form.loginEmail || loading}
        >
          Resend verification email
        </button>
      </div>
      {googleEnabled && (
        <div className="space-y-4">
          <div className="text-center text-sm text-gray-500">or</div>
          <div className="flex flex-col gap-3">
            <input
              type="text"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="Workspace name (for first-time Google sign-in)"
              value={form.googleTenantName}
              onChange={e => updateForm('googleTenantName', e.target.value)}
            />
            <select
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={form.googleCountry}
              onChange={e => updateForm('googleCountry', e.target.value)}
            >
              <option value="GB">United Kingdom</option>
              <option value="IE">Ireland</option>
              <option value="US">United States</option>
            </select>
            <GoogleLogin
              onSuccess={credentialResponse => handleGoogleSuccess(credentialResponse.credential)}
              onError={() => setError('Google sign-in failed')}
              shape="pill"
              size="large"
            />
          </div>
        </div>
      )}
    </form>
  );

  const renderRegister = () => (
    <form className="space-y-4" onSubmit={handleRegister}>
      <input
        type="text"
        required
        className="w-full rounded-lg border px-3 py-2"
        placeholder="Full name"
        value={form.name}
        onChange={e => updateForm('name', e.target.value)}
      />
      <input
        type="email"
        required
        className="w-full rounded-lg border px-3 py-2"
        placeholder="Work email"
        value={form.registerEmail}
        onChange={e => updateForm('registerEmail', e.target.value)}
      />
      <input
        type="password"
        required
        className="w-full rounded-lg border px-3 py-2"
        placeholder="Password (12+ chars, mixed case, number, symbol)"
        value={form.registerPassword}
        onChange={e => updateForm('registerPassword', e.target.value)}
      />
      <input
        type="text"
        required
        className="w-full rounded-lg border px-3 py-2"
        placeholder="Workspace name"
        value={form.tenantName}
        onChange={e => updateForm('tenantName', e.target.value)}
      />
      <select
        className="w-full rounded-lg border px-3 py-2"
        value={form.country}
        onChange={e => updateForm('country', e.target.value)}
      >
        <option value="GB">United Kingdom</option>
        <option value="IE">Ireland</option>
        <option value="US">United States</option>
      </select>
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
      >
        {loading ? 'Creating workspace…' : 'Create account'}
      </button>
      <button type="button" className="w-full text-sm text-gray-600 underline" onClick={() => setMode('login')}>
        Back to sign in
      </button>
    </form>
  );

  const renderForgot = () => (
    <form className="space-y-4" onSubmit={handleForgot}>
      <input
        type="email"
        required
        className="w-full rounded-lg border px-3 py-2"
        placeholder="Work email"
        value={form.loginEmail}
        onChange={e => updateForm('loginEmail', e.target.value)}
      />
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
      >
        {loading ? 'Sending reset link…' : 'Send reset link'}
      </button>
      <button type="button" className="w-full text-sm text-gray-600 underline" onClick={() => setMode('login')}>
        Back to sign in
      </button>
    </form>
  );

  const renderMfa = () => (
    <form className="space-y-4" onSubmit={handleMfaSubmit}>
      <input
        type="text"
        required
        inputMode="numeric"
        className="w-full rounded-lg border px-3 py-2 text-center tracking-widest"
        placeholder="123456"
        value={form.mfaCode}
        onChange={e => updateForm('mfaCode', e.target.value)}
      />
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
      >
        {loading ? 'Verifying…' : 'Verify code'}
      </button>
      <button type="button" className="w-full text-sm text-gray-600 underline" onClick={() => setMode('login')}>
        Back to login
      </button>
    </form>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl bg-white p-8 shadow-xl">
        <div className="text-center space-y-1">
          <p className="text-sm uppercase tracking-wide text-blue-600">AI Accountant</p>
          <h1 className="text-3xl font-bold text-gray-900">
            {mode === 'register'
              ? 'Create your workspace'
              : mode === 'forgot'
              ? 'Reset password'
              : mode === 'mfa'
              ? 'Multi-factor authentication'
              : 'Sign in to continue'}
          </h1>
          <p className="text-sm text-gray-500">
            {mode === 'register'
              ? 'Set up your organisation and invite your team.'
              : mode === 'forgot'
              ? 'We will email you a secure reset link.'
              : mode === 'mfa'
              ? 'Enter the 6-digit code from your authenticator app.'
              : 'Secure access to your AI accountant.'}
          </p>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {status && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{status}</div>
        )}

        {mode === 'login' && renderLogin()}
        {mode === 'register' && renderRegister()}
        {mode === 'forgot' && renderForgot()}
        {mode === 'mfa' && renderMfa()}
      </div>
    </div>
  );
}

export default function LoginForm() {
  if (!GOOGLE_CLIENT_ID) {
    return <AuthCard googleEnabled={false} />;
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthCard googleEnabled />
    </GoogleOAuthProvider>
  );
}
