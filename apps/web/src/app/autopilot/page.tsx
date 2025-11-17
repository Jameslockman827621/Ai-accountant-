'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AutopilotDashboard from '@/components/AutopilotDashboard';
import TaskBoard from '@/components/TaskBoard';

export default function AutopilotPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<'dashboard' | 'board'>('dashboard');
  const router = useRouter();

  useEffect(() => {
    const storedToken = localStorage.getItem('authToken') || localStorage.getItem('auth_token');
    if (storedToken) {
      setToken(storedToken);
    } else {
      router.push('/');
    }
    setLoading(false);
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
          <p className="text-gray-600">Loading autopilot...</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-2xl font-semibold text-gray-900">Daily Autopilot</h1>
            <nav className="flex space-x-1">
              <button
                onClick={() => setActiveView('dashboard')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  activeView === 'dashboard'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Dashboard
              </button>
              <button
                onClick={() => setActiveView('board')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  activeView === 'board'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Task Board
              </button>
            </nav>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeView === 'dashboard' && <AutopilotDashboard token={token} />}
        {activeView === 'board' && <TaskBoard token={token} />}
      </div>
    </div>
  );
}
