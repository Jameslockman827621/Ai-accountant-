'use client';

import { useEffect, useState } from 'react';
import ReconciliationDashboard from '../../components/ReconciliationDashboard';
import ExceptionQueue from '../../components/ExceptionQueue';
import ReconciliationReport from '../../components/ReconciliationReport';

export default function ReconciliationPage() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
    setToken(stored);
  }, []);

  if (!token) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Reconciliation</h1>
        <p className="text-gray-600">Sign in to view reconciliation dashboards.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-8 bg-gray-50 min-h-screen">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Reconciliation</h1>
        <p className="text-gray-600">Monitor bank feed health, review exceptions, and generate reports.</p>
      </header>

      <ReconciliationDashboard token={token} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-4">
          <ExceptionQueue token={token} tenantId="self" />
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <ReconciliationReport />
        </div>
      </div>
    </div>
  );
}
