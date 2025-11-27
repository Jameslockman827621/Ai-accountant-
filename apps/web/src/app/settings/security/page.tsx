'use client';

import { useCallback, useEffect, useState } from 'react';

interface Session {
  id: string;
  device: string;
  location: string;
  ip: string;
  lastActive: string;
  trusted: boolean;
}

export default function SecuritySettingsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshSessions = useCallback(() => {
    setLoading(true);
    // Placeholder data until backend device/session endpoint is available
    setTimeout(() => {
      setSessions([
        {
          id: 'current',
          device: 'MacBook Pro · Chrome',
          location: 'London, UK',
          ip: '10.0.0.12',
          lastActive: 'Just now',
          trusted: true,
        },
        {
          id: 'alt-1',
          device: 'iPhone 15 · Safari',
          location: 'London, UK',
          ip: '10.0.0.54',
          lastActive: '2 hours ago',
          trusted: true,
        },
        {
          id: 'alt-2',
          device: 'Windows 11 · Edge',
          location: 'Dublin, IE',
          ip: '52.214.10.10',
          lastActive: 'Yesterday',
          trusted: false,
        },
      ]);
      setLoading(false);
    }, 300);
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const revokeSession = (id: string) => {
    setSessions(current => current.filter(session => session.id !== id));
  };

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Security</h1>
        <p className="text-gray-600">Manage MFA, adaptive authentication, and active device sessions.</p>
      </div>

      <section className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-gray-900">Adaptive authentication</h2>
        <p className="mt-2 text-gray-600">
          MFA is enforced automatically when we detect risky sign-in signals such as untrusted networks or unusual clients.
          You will be prompted for your MFA code when the system detects elevated risk.
        </p>
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-4 text-green-800">
          Adaptive authentication is enabled. Risky sign-ins will be challenged with MFA.
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Active devices & sessions</h2>
            <p className="mt-1 text-gray-600">Review devices, revoke unknown sessions, and monitor trusted devices.</p>
          </div>
          <button
            type="button"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            onClick={refreshSessions}
            disabled={loading}
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="mt-4 text-sm text-gray-500">Loading sessions…</div>
        ) : (
          <div className="mt-4 divide-y divide-gray-200">
            {sessions.map(session => (
              <div key={session.id} className="flex items-center justify-between py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-base font-medium text-gray-900">{session.device}</p>
                    {session.trusted ? (
                      <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">Trusted</span>
                    ) : (
                      <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">Unrecognized</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">
                    {session.location} · {session.ip} · Last active {session.lastActive}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                  onClick={() => revokeSession(session.id)}
                >
                  Revoke
                </button>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="py-6 text-center text-sm text-gray-500">No active sessions.</div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
