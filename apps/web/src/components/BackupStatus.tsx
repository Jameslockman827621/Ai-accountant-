'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('BackupStatus');

interface Backup {
  id: string;
  backupType: 'full' | 'incremental';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  sizeBytes: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export default function BackupStatus() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/backup', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load backups');

      const data = await response.json();
      setBackups(data.backups || []);
    } catch (error) {
      logger.error('Failed to load backups', error);
    } finally {
      setLoading(false);
    }
  };

  const createBackup = async () => {
    setCreating(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ backupType: 'incremental' }),
      });

      if (!response.ok) throw new Error('Failed to create backup');

      alert('Backup started. You will be notified when it completes.');
      await loadBackups();
    } catch (error) {
      logger.error('Failed to create backup', error);
      alert('Failed to create backup');
    } finally {
      setCreating(false);
    }
  };

  const downloadBackup = async (backupId: string) => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/backup/${backupId}/download`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to download backup');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${backupId}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      logger.error('Failed to download backup', error);
      alert('Failed to download backup');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Backup Status</h2>
        <div className="flex gap-2">
          <button
            onClick={loadBackups}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
          >
            Refresh
          </button>
          <button
            onClick={createBackup}
            disabled={creating}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Backup'}
          </button>
        </div>
      </div>

      {loading && backups.length === 0 ? (
        <div className="text-gray-500">Loading backups...</div>
      ) : backups.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No backups found. Create your first backup to get started.
        </div>
      ) : (
        <div className="space-y-4">
          {backups.map((backup) => (
            <div
              key={backup.id}
              className="border rounded-lg p-4"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="font-semibold">
                      {backup.backupType === 'full' ? 'Full' : 'Incremental'} Backup
                    </p>
                    <span className={`px-2 py-1 rounded text-xs ${getStatusColor(backup.status)}`}>
                      {backup.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">
                    Started: {new Date(backup.startedAt).toLocaleString()}
                  </p>
                  {backup.completedAt && (
                    <p className="text-sm text-gray-600">
                      Completed: {new Date(backup.completedAt).toLocaleString()}
                    </p>
                  )}
                  {backup.sizeBytes > 0 && (
                    <p className="text-sm text-gray-600">
                      Size: {formatSize(backup.sizeBytes)}
                    </p>
                  )}
                  {backup.error && (
                    <p className="text-sm text-red-600 mt-2">
                      Error: {backup.error}
                    </p>
                  )}
                </div>
                {backup.status === 'completed' && (
                  <button
                    onClick={() => downloadBackup(backup.id)}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Download
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded">
        <p className="text-sm text-blue-800">
          <strong>Automated Backups:</strong> Your data is automatically backed up daily.
          Manual backups can be created at any time.
        </p>
      </div>
    </div>
  );
}
