'use client';

import { useState, useEffect } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
}

export type LoginResult =
  | { status: 'success' }
  | { status: 'mfa_required'; challengeToken: string | null }
  | { status: 'verification_required'; message: string }
  | { status: 'error'; message: string };

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    token: null,
  });

  useEffect(() => {
    // Check for stored auth
    const storedToken = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('auth_user');

    if (storedToken && storedUser) {
      setAuthState({
        token: storedToken,
        user: JSON.parse(storedUser),
      });
    }
  }, []);

  const persistAuthState = (token: string, user: User) => {
    setAuthState({ token, user });
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(user));
  };

  const login = async (email: string, password: string): Promise<LoginResult> => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          status: data?.requiresEmailVerification ? 'verification_required' : 'error',
          message: data?.error || 'Login failed',
        };
      }

      if (data.requiresMfa) {
        return { status: 'mfa_required', challengeToken: data.challengeToken };
      }

      persistAuthState(data.token, data.user);
      return { status: 'success' };
    } catch (error) {
      console.error('Login error:', error);
      return { status: 'error', message: error instanceof Error ? error.message : 'Login failed' };
    }
  };

  const verifyMfa = async (challengeToken: string, code: string): Promise<LoginResult> => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/auth/mfa/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ challengeToken, code }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { status: 'error', message: data?.error || 'Unable to verify MFA code' };
      }

      persistAuthState(data.token, data.user);
      return { status: 'success' };
    } catch (error) {
      console.error('Verify MFA error:', error);
      return { status: 'error', message: error instanceof Error ? error.message : 'Unable to verify MFA code' };
    }
  };

  const register = async (payload: {
    email: string;
    password: string;
    name: string;
    tenantName: string;
    country: string;
  }): Promise<{ message: string }> => {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'Registration failed');
    }

    return { message: data?.message || 'Registration successful. Please verify your email.' };
  };

  const resendVerification = async (email: string): Promise<void> => {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/auth/email/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data?.error || 'Unable to resend verification email');
    }
  };

  const requestPasswordReset = async (email: string): Promise<void> => {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/auth/password/forgot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data?.error || 'Unable to start password reset');
    }
  };

  const resetPassword = async (token: string, password: string): Promise<void> => {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/auth/password/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token, password }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'Unable to reset password');
    }
  };

  const loginWithGoogle = async (idToken: string, extra?: { tenantName?: string; country?: string }): Promise<LoginResult> => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/auth/sso/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idToken, ...extra }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { status: 'error', message: data?.error || 'Google sign-in failed' };
      }

      if (data.requiresMfa) {
        return { status: 'mfa_required', challengeToken: data.challengeToken ?? null };
      }

      persistAuthState(data.token, data.user);
      return { status: 'success' };
    } catch (error) {
      console.error('Google login error:', error);
      return { status: 'error', message: error instanceof Error ? error.message : 'Google sign-in failed' };
    }
  };

  const logout = () => {
    setAuthState({ user: null, token: null });
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
  };

  return {
    ...authState,
    login,
    loginWithGoogle,
    verifyMfa,
    register,
    resendVerification,
    requestPasswordReset,
    resetPassword,
    logout,
  };
}
