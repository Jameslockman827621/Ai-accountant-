'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('NotificationCenter');

interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  action?: {
    label: string;
    onClick?: () => void;
    url?: string;
  };
  metadata?: Record<string, unknown>;
}

interface NotificationEnvelope {
  notifications: Notification[];
  unreadCount: number;
  channelBreakdown: Record<string, number>;
}

export default function NotificationCenter() {
  const [data, setData] = useState<NotificationEnvelope>({ notifications: [], unreadCount: 0, channelBreakdown: {} });
  const [isOpen, setIsOpen] = useState(false);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadNotifications = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/notifications', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load notifications');

      const raw = await response.json();
      const notifs = (raw.notifications || []).map((n: any) => ({
        ...n,
        timestamp: new Date(n.createdAt || n.timestamp),
      }));

      setData({
        notifications: notifs,
        unreadCount: raw.unreadCount || notifs.filter((n: Notification) => !n.read).length,
        channelBreakdown: raw.channelBreakdown || {},
      });
    } catch (error) {
      logger.error('Failed to load notifications', error);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const token = localStorage.getItem('authToken');
      await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      setData(prev => ({
        ...prev,
        notifications: prev.notifications.map(n => n.id === notificationId ? { ...n, read: true } : n),
        unreadCount: Math.max(0, prev.unreadCount - 1),
      }));
    } catch (error) {
      logger.error('Failed to mark as read', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      const token = localStorage.getItem('authToken');
      await fetch('/api/notifications/read-all', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      setData(prev => ({
        ...prev,
        notifications: prev.notifications.map(n => ({ ...n, read: true })),
        unreadCount: 0,
      }));
    } catch (error) {
      logger.error('Failed to mark all as read', error);
    }
  };

  const filtered = useMemo(() => {
    return data.notifications.filter(n => {
      const channel = (n.metadata?.channel as string) || 'in_app';
      const channelMatch = channelFilter === 'all' || channel === channelFilter || channel.includes(channelFilter);
      const typeMatch = typeFilter === 'all' || n.type === typeFilter;
      return channelMatch && typeMatch;
    });
  }, [data.notifications, channelFilter, typeFilter]);

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      default:
        return 'ℹ️';
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      default:
        return 'bg-blue-50 border-blue-200';
    }
  };

  const renderChannelFilters = () => {
    const channels = ['all', ...Object.keys(data.channelBreakdown)];
    return (
      <div className="flex gap-2 text-sm">
        {channels.map(channel => (
          <button
            key={channel}
            onClick={() => setChannelFilter(channel)}
            className={`px-3 py-1 rounded-full border ${channelFilter === channel ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
          >
            {channel === 'all' ? 'All channels' : channel} ({channel === 'all' ? data.notifications.length : data.channelBreakdown[channel] || 0})
          </button>
        ))}
      </div>
    );
  };

  const renderTypeFilters = () => {
    const types: Array<Notification['type'] | 'all'> = ['all', 'success', 'info', 'warning', 'error'];
    return (
      <div className="flex gap-2 text-sm">
        {types.map(type => (
          <button
            key={type}
            onClick={() => setTypeFilter(type)}
            className={`px-3 py-1 rounded-full border ${typeFilter === type ? 'bg-slate-800 text-white' : 'bg-white text-gray-700'}`}
          >
            {type === 'all' ? 'All types' : type}
          </button>
        ))}
      </div>
    );
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:text-gray-900"
        aria-label="Open notification center"
      >
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {data.unreadCount > 0 && (
          <span className="absolute top-0 right-0 block h-4 w-4 rounded-full bg-red-600 text-white text-xs flex items-center justify-center">
            {data.unreadCount > 9 ? '9+' : data.unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50" onClick={() => setIsOpen(false)}>
          <div
            className="absolute top-16 right-4 w-[520px] bg-white rounded-lg shadow-xl max-h-[640px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold">Notification Center</h3>
                <p className="text-xs text-gray-500">Email, in-app, and webhook alerts with automatic retry/backoff</p>
              </div>
              <div className="flex gap-2 items-center">
                {data.unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-gray-500 hover:text-gray-700"
                  aria-label="Close notifications"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-4 border-b space-y-2">
              {renderChannelFilters()}
              {renderTypeFilters()}
              <div className="text-xs text-gray-500">
                Unread: {data.unreadCount} · Channels: {Object.keys(data.channelBreakdown).length || 1}
              </div>
            </div>

            <div className="overflow-y-auto max-h-[500px]">
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-gray-500">No notifications</div>
              ) : (
                <div className="divide-y">
                  {filtered.map((notification) => {
                    const channel = (notification.metadata?.channel as string) || 'in_app';
                    return (
                      <div
                        key={notification.id}
                        className={`p-4 hover:bg-gray-50 cursor-pointer ${!notification.read ? 'bg-blue-50' : ''}`}
                        onClick={() => !notification.read && markAsRead(notification.id)}
                      >
                        <div className={`p-3 rounded border ${getNotificationColor(notification.type)}`}>
                          <div className="flex items-start gap-2">
                            <span className="text-xl">{getNotificationIcon(notification.type)}</span>
                            <div className="flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-medium">{notification.title}</p>
                                <span className="text-[10px] uppercase tracking-wide text-gray-500">{channel}</span>
                              </div>
                              <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
                              <p className="text-xs text-gray-500 mt-2">
                                {notification.timestamp.toLocaleString()}
                              </p>
                              {notification.action && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (notification.action?.onClick) {
                                      notification.action.onClick();
                                    } else if (notification.action?.url) {
                                      window.open(notification.action.url, '_blank');
                                    }
                                  }}
                                  className="mt-2 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                                >
                                  {notification.action.label}
                                </button>
                              )}
                            </div>
                            {!notification.read && (
                              <span className="h-2 w-2 bg-blue-600 rounded-full"></span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
