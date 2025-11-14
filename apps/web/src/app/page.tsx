'use client';

import LoginForm from '@/components/LoginForm';
import Dashboard from '@/components/Dashboard';
import { useAuth } from '@/hooks/useAuth';

export default function Home() {
  const { user, token, login, logout } = useAuth();

  if (!user || !token) {
    return <LoginForm onLogin={login} />;
  }

  return <Dashboard user={user} token={token} onLogout={logout} />;
}
