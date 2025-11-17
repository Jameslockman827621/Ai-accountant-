'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ComplianceMode from '@/components/ComplianceMode';
import ComplianceEvidenceDashboard from '@/components/ComplianceEvidenceDashboard';
import ComplianceWarning from '@/components/ComplianceWarning';
import ReadinessDashboard from '@/components/ReadinessDashboard';
import ComplianceCalendar from '@/components/ComplianceCalendar';

export default function CompliancePage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'mode' | 'evidence' | 'readiness' | 'calendar'>('mode');
  const router = useRouter();

  useEffect(() => {
    // In production, get token from auth context or localStorage
    const storedToken = localStorage.getItem('authToken') || localStorage.getItem('auth_token');
    if (storedToken) {
      setToken(storedToken);
    } else {
      // Redirect to login if no token
      router.push('/');
    }
    setLoading(false);
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
          <p className="text-gray-600">Loading compliance dashboard...</p>
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
            <h1 className="text-2xl font-semibold text-gray-900">Compliance Dashboard</h1>
            <nav className="flex space-x-1">
              <button
                onClick={() => setActiveTab('mode')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  activeTab === 'mode'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Compliance Mode
              </button>
              <button
                onClick={() => setActiveTab('readiness')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  activeTab === 'readiness'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Readiness
              </button>
              <button
                onClick={() => setActiveTab('calendar')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  activeTab === 'calendar'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Calendar
              </button>
              <button
                onClick={() => setActiveTab('evidence')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  activeTab === 'evidence'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Evidence
              </button>
            </nav>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'mode' && <ComplianceMode token={token} />}
        {activeTab === 'readiness' && <ReadinessDashboard token={token} />}
        {activeTab === 'calendar' && <ComplianceCalendar token={token} />}
        {activeTab === 'evidence' && <ComplianceEvidenceDashboard />}
      </div>
    </div>
  );
}
