'use client';

import LoginForm from '@/components/LoginForm';
import Dashboard from '@/components/Dashboard';
import { useAuth } from '@/hooks/useAuth';

export default function Home() {
  const { user, token, logout } = useAuth();

  if (!user || !token) {
    return <LoginForm />;
  }

  return <Dashboard user={user} token={token} onLogout={logout} />;
}
