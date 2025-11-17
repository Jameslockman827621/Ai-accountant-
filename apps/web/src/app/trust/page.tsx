'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TrustDashboard from '@/components/TrustDashboard';
import SecurityCenter from '@/components/SecurityCenter';
import SecurityEventsDashboard from '@/components/SecurityEventsDashboard';
import AccountSecurityPanel from '@/components/AccountSecurityPanel';

export default function TrustPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'security' | 'events' | 'account'>('dashboard');
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
          <p className="text-gray-600">Loading trust dashboard...</p>
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
            <h1 className="text-2xl font-semibold text-gray-900">Trust & Security</h1>
            <nav className="flex space-x-1">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  activeTab === 'dashboard'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Trust Dashboard
              </button>
              <button
                onClick={() => setActiveTab('security')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  activeTab === 'security'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Security Center
              </button>
              <button
                onClick={() => setActiveTab('events')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  activeTab === 'events'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Security Events
              </button>
              <button
                onClick={() => setActiveTab('account')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  activeTab === 'account'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Account Security
              </button>
            </nav>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'dashboard' && <TrustDashboard />}
        {activeTab === 'security' && <SecurityCenter token={token} />}
        {activeTab === 'events' && <SecurityEventsDashboard />}
        {activeTab === 'account' && (
          <AccountSecurityPanel
            token={token}
            email=""
            emailVerified={false}
            mfaEnabled={false}
            onRefresh={() => {}}
          />
        )}
      </div>
    </div>
  );
}
