import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface MobileUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  token: string | null;
  user: MobileUser | null;
}

const AUTH_TOKEN_KEY = '@ai-accountant/token';
const AUTH_USER_KEY = '@ai-accountant/user';
const API_BASE =
  (process.env.EXPO_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3000').replace(/\/$/, '');

export function useAuth() {
  const [state, setState] = useState<AuthState>({ token: null, user: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function hydrate() {
      try {
        const [storedToken, storedUser] = await Promise.all([
          AsyncStorage.getItem(AUTH_TOKEN_KEY),
          AsyncStorage.getItem(AUTH_USER_KEY),
        ]);

        setState({
          token: storedToken,
          user: storedUser ? (JSON.parse(storedUser) as MobileUser) : null,
        });
      } catch (err) {
        console.error('Failed to hydrate auth state', err);
        setError('Unable to load saved session.');
      } finally {
        setLoading(false);
      }
    }

    hydrate();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      throw new Error('Login failed');
    }

    const payload = await response.json() as { token: string; user: MobileUser };
    setState({ token: payload.token, user: payload.user });

    await Promise.all([
      AsyncStorage.setItem(AUTH_TOKEN_KEY, payload.token),
      AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(payload.user)),
    ]);
  }, []);

  const logout = useCallback(async () => {
    setState({ token: null, user: null });
    await Promise.all([
      AsyncStorage.removeItem(AUTH_TOKEN_KEY),
      AsyncStorage.removeItem(AUTH_USER_KEY),
    ]);
  }, []);

  return {
    token: state.token,
    user: state.user,
    loading,
    error,
    login,
    logout,
  };
}
