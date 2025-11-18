'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('NotificationPreferences');

interface NotificationPreference {
  channel: 'email' | 'sms' | 'in_app' | 'push';
  category: string;
  enabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
}

interface PreferenceCategory {
  id: string;
  name: string;
  description: string;
  defaultChannels: ('email' | 'sms' | 'in_app' | 'push')[];
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface NotificationPreferencesProps {
  token: string;
  tenantId: string;
}

const categories: PreferenceCategory[] = [
  {
    id: 'daily_digest',
    name: 'Daily Digest',
    description: 'Summary of unprocessed documents, unmatched transactions, and exceptions',
    defaultChannels: ['email', 'in_app'],
  },
  {
    id: 'critical_alerts',
    name: 'Critical Alerts',
    description: 'Immediate notifications for urgent issues requiring attention',
    defaultChannels: ['email', 'sms', 'push', 'in_app'],
  },
  {
    id: 'classification_review',
    name: 'Classification Review',
    description: 'Notifications when documents require manual review',
    defaultChannels: ['email', 'in_app'],
  },
  {
    id: 'reconciliation_exceptions',
    name: 'Reconciliation Exceptions',
    description: 'Alerts for unmatched transactions and reconciliation issues',
    defaultChannels: ['email', 'in_app'],
  },
  {
    id: 'connector_status',
    name: 'Connector Status',
    description: 'Updates on connector health and sync failures',
    defaultChannels: ['email'],
  },
  {
    id: 'filing_reminders',
    name: 'Filing Reminders',
    description: 'Reminders for upcoming tax filing deadlines',
    defaultChannels: ['email', 'in_app'],
  },
];

export default function NotificationPreferences({ token, tenantId: _tenantId }: NotificationPreferencesProps) {
  const [preferences, setPreferences] = useState<Record<string, NotificationPreference[]>>({});
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState('22:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('08:00');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/notifications/preferences`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setPreferences(data.preferences || {});
        setQuietHoursEnabled(data.quietHoursEnabled || false);
        if (data.quietHoursStart) setQuietHoursStart(data.quietHoursStart);
        if (data.quietHoursEnd) setQuietHoursEnd(data.quietHoursEnd);
      }
    } catch (error) {
      logger.error('Failed to load preferences', error);
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/api/notifications/preferences`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          preferences,
          quietHoursEnabled,
          quietHoursStart,
          quietHoursEnd,
        }),
      });

      if (!response.ok) throw new Error('Failed to save preferences');

      alert('Preferences saved successfully');
    } catch (error) {
      logger.error('Failed to save preferences', error);
      alert('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const toggleChannel = (categoryId: string, channel: 'email' | 'sms' | 'in_app' | 'push') => {
    const categoryPrefs = preferences[categoryId] || [];
    const existing = categoryPrefs.find(p => p.channel === channel);

    if (existing) {
      const updated = categoryPrefs.map(p =>
        p.channel === channel ? { ...p, enabled: !p.enabled } : p
      );
      setPreferences({ ...preferences, [categoryId]: updated });
    } else {
      setPreferences({
        ...preferences,
        [categoryId]: [
          ...categoryPrefs,
          { channel, category: categoryId, enabled: true },
        ],
      });
    }
  };

  const isChannelEnabled = (categoryId: string, channel: 'email' | 'sms' | 'in_app' | 'push') => {
    const categoryPrefs = preferences[categoryId] || [];
    const pref = categoryPrefs.find(p => p.channel === channel);
    return pref?.enabled ?? categories.find(c => c.id === categoryId)?.defaultChannels.includes(channel) ?? false;
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Notification Preferences</h1>
          <p className="text-gray-600 mt-1">Manage how and when you receive notifications</p>
        </div>
        <button
          onClick={savePreferences}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Preferences'}
        </button>
      </div>

      {/* Quiet Hours */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Quiet Hours</h2>
            <p className="text-sm text-gray-500 mt-1">
              Suppress non-critical notifications during these hours
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={quietHoursEnabled}
              onChange={(e) => setQuietHoursEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        {quietHoursEnabled && (
          <div className="flex items-center space-x-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
              <input
                type="time"
                value={quietHoursStart}
                onChange={(e) => setQuietHoursStart(e.target.value)}
                className="border border-gray-300 rounded-lg p-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
              <input
                type="time"
                value={quietHoursEnd}
                onChange={(e) => setQuietHoursEnd(e.target.value)}
                className="border border-gray-300 rounded-lg p-2"
              />
            </div>
          </div>
        )}
      </div>

      {/* Category Preferences */}
      <div className="space-y-4">
        {categories.map(category => (
          <div key={category.id} className="rounded-lg border border-gray-200 bg-white p-6">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{category.name}</h3>
              <p className="text-sm text-gray-500 mt-1">{category.description}</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {(['email', 'sms', 'in_app', 'push'] as const).map(channel => (
                <label
                  key={channel}
                  className="flex items-center space-x-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={isChannelEnabled(category.id, channel)}
                    onChange={() => toggleChannel(category.id, channel)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700 capitalize">
                    {channel.replace('_', ' ')}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
