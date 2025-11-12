import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

export function GDPRConsent() {
  const { token } = useAuth();
  const [consents, setConsents] = useState({
    marketing: false,
    analytics: false,
    dataSharing: false,
  });

  useEffect(() => {
    async function fetchConsents() {
      const response = await fetch('/api/compliance/consent', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setConsents(data);
      }
    }
    if (token) {
      fetchConsents();
    }
  }, [token]);

  const updateConsent = async (type: string, granted: boolean) => {
    await fetch('/api/compliance/consent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ type, granted }),
    });
    setConsents({ ...consents, [type]: granted });
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Privacy Preferences</h1>

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="font-semibold">Marketing Communications</h3>
            <p className="text-sm text-gray-600">
              Receive emails about new features and updates
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={consents.marketing}
              onChange={(e) => updateConsent('marketing', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        <div className="flex justify-between items-center">
          <div>
            <h3 className="font-semibold">Analytics</h3>
            <p className="text-sm text-gray-600">
              Help us improve by sharing usage analytics
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={consents.analytics}
              onChange={(e) => updateConsent('analytics', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        <div className="flex justify-between items-center">
          <div>
            <h3 className="font-semibold">Data Sharing</h3>
            <p className="text-sm text-gray-600">
              Allow sharing anonymized data with partners
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={consents.dataSharing}
              onChange={(e) => updateConsent('dataSharing', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
      </div>

      <div className="mt-6 space-y-2">
        <button
          onClick={async () => {
            const response = await fetch('/api/compliance/export-data', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            });
            if (response.ok) {
              alert('Data export requested. You will receive an email when ready.');
            }
          }}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Request Data Export
        </button>

        <button
          onClick={async () => {
            if (confirm('Are you sure you want to delete all your data? This cannot be undone.')) {
              const response = await fetch('/api/compliance/delete-data', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              });
              if (response.ok) {
                alert('Data deletion requested. This will be processed within 30 days.');
              }
            }
          }}
          className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
        >
          Request Data Deletion
        </button>
      </div>
    </div>
  );
}
