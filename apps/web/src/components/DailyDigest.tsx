'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('DailyDigest');

interface DigestItem {
  type: 'documents' | 'reconciliation' | 'exceptions' | 'deadlines' | 'anomalies';
  title: string;
  message: string;
  count: number;
  actionUrl: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

interface DailyDigest {
  date: string;
  items: DigestItem[];
  summary: {
    totalItems: number;
    urgentItems: number;
    completedToday: number;
    automationRate: number;
  };
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface DailyDigestProps {
  token: string;
  tenantId: string;
}

export default function DailyDigest({ token, tenantId }: DailyDigestProps) {
  const [digest, setDigest] = useState<DailyDigest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDigest();
  }, []);

  const loadDigest = async () => {
    try {
      // Get digest from notification service
      const response = await fetch(`${API_BASE}/api/notifications/digest`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        // Transform notification digest to our format
        const items: DigestItem[] = (data.digest?.items || []).map((item: any) => ({
          type: item.type as DigestItem['type'],
          title: item.title,
          message: item.message,
          count: 0, // Would parse from message
          actionUrl: item.actionUrl || '#',
          priority: 'medium',
        }));

        setDigest({
          date: new Date().toISOString().split('T')[0],
          items,
          summary: {
            totalItems: items.length,
            urgentItems: items.filter(i => i.priority === 'urgent').length,
            completedToday: 0, // Would calculate
            automationRate: 0, // Would calculate
          },
        });
      }
    } catch (error) {
      logger.error('Failed to load daily digest', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!digest) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
        No digest available
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Daily Digest</h1>
          <p className="text-gray-600 mt-1">
            {new Date(digest.date).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <button
          onClick={loadDigest}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard title="Total Items" value={digest.summary.totalItems} color="blue" />
        <SummaryCard title="Urgent" value={digest.summary.urgentItems} color="red" />
        <SummaryCard title="Completed Today" value={digest.summary.completedToday} color="green" />
        <SummaryCard
          title="Automation Rate"
          value={`${digest.summary.automationRate}%`}
          color="purple"
        />
      </div>

      {/* Digest Items */}
      <div className="space-y-4">
        {digest.items.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
            <p className="text-gray-500">All caught up! No items requiring attention.</p>
          </div>
        ) : (
          digest.items.map((item, index) => (
            <DigestItemCard key={index} item={item} />
          ))
        )}
      </div>
    </div>
  );
}

function SummaryCard({ title, value, color }: { title: string; value: string | number; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <p className="text-sm font-medium opacity-80">{title}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}

function DigestItemCard({ item }: { item: DigestItem }) {
  const typeIcons: Record<DigestItem['type'], string> = {
    documents: '📄',
    reconciliation: '🔄',
    exceptions: '⚠️',
    deadlines: '📅',
    anomalies: '🔍',
  };

  const priorityColors = {
    urgent: 'border-red-300 bg-red-50',
    high: 'border-orange-300 bg-orange-50',
    medium: 'border-yellow-300 bg-yellow-50',
    low: 'border-gray-300 bg-gray-50',
  };

  return (
    <div className={`rounded-lg border p-4 ${priorityColors[item.priority]}`}>
      <div className="flex items-start space-x-4">
        <div className="text-2xl">{typeIcons[item.type]}</div>
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-1">
            <h3 className="font-semibold text-gray-900">{item.title}</h3>
            <PriorityBadge priority={item.priority} />
          </div>
          <p className="text-sm text-gray-600 mb-2">{item.message}</p>
          <a
            href={item.actionUrl}
            className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
          >
            View Details →
          </a>
        </div>
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: DigestItem['priority'] }) {
  const colors = {
    urgent: 'bg-red-100 text-red-800',
    high: 'bg-orange-100 text-orange-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[priority]}`}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  );
}
