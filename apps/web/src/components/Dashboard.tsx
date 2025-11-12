import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

interface DashboardStats {
  revenue: number;
  expenses: number;
  profit: number;
  vatDue: number;
  upcomingDeadlines: Array<{ type: string; due: Date; amount: number }>;
}

export function Dashboard() {
  const { token } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch('/api/dashboard/stats', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setStats(data);
        }
      } catch (error) {
        console.error('Failed to fetch dashboard stats', error);
      } finally {
        setLoading(false);
      }
    }

    if (token) {
      fetchStats();
    }
  }, [token]);

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  if (!stats) {
    return <div className="flex items-center justify-center h-screen">No data available</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Revenue"
            value={`£${stats.revenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            trend="up"
            color="green"
          />
          <StatCard
            title="Expenses"
            value={`£${stats.expenses.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            trend="down"
            color="red"
          />
          <StatCard
            title="Profit"
            value={`£${stats.profit.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            trend={stats.profit >= 0 ? 'up' : 'down'}
            color={stats.profit >= 0 ? 'green' : 'red'}
          />
          <StatCard
            title="VAT Due"
            value={`£${stats.vatDue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            trend="neutral"
            color="blue"
          />
        </div>

        {/* Upcoming Deadlines */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Upcoming Deadlines</h2>
          {stats.upcomingDeadlines.length > 0 ? (
            <div className="space-y-3">
              {stats.upcomingDeadlines.map((deadline, index) => (
                <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                  <div>
                    <p className="font-medium">{deadline.type}</p>
                    <p className="text-sm text-gray-600">
                      Due: {new Date(deadline.due).toLocaleDateString('en-GB')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">£{deadline.amount.toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">No upcoming deadlines</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, trend, color }: {
  title: string;
  value: string;
  trend: 'up' | 'down' | 'neutral';
  color: 'green' | 'red' | 'blue';
}) {
  const colorClasses = {
    green: 'bg-green-50 border-green-200',
    red: 'bg-red-50 border-red-200',
    blue: 'bg-blue-50 border-blue-200',
  };

  return (
    <div className={`bg-white rounded-lg shadow p-6 border-l-4 ${colorClasses[color]}`}>
      <h3 className="text-sm font-medium text-gray-600 mb-2">{title}</h3>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
