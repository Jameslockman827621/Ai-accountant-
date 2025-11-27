'use client';

import React, { useEffect, useState } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('IncidentBanners');

interface Incident {
  id: string;
  ruleName: string;
  severity: 'info' | 'warning' | 'critical';
  firedAt: string;
  runbookUrl: string | null;
  serviceName: string | null;
  context?: Record<string, unknown>;
}

function badgeColor(severity: Incident['severity']) {
  switch (severity) {
    case 'critical':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'warning':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    default:
      return 'bg-blue-100 text-blue-800 border-blue-300';
  }
}

export default function IncidentBanners() {
  const [incidents, setIncidents] = useState<Incident[]>([]);

  useEffect(() => {
    const fetchIncidents = async () => {
      try {
        const token = localStorage.getItem('authToken');
        const res = await fetch('/api/monitoring/incidents/active', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) throw new Error('Failed to load incidents');
        const body = await res.json();
        setIncidents(body.incidents || []);
      } catch (error) {
        logger.error('Failed to load active incidents', error);
      }
    };

    fetchIncidents();
    const interval = setInterval(fetchIncidents, 60000);
    return () => clearInterval(interval);
  }, []);

  if (incidents.length === 0) return null;

  return (
    <div className="space-y-3">
      {incidents.map(incident => (
        <div
          key={incident.id}
          className="border rounded-lg p-3 bg-white shadow-sm flex items-start gap-3"
        >
          <div className={`text-xs px-2 py-1 rounded-full border ${badgeColor(incident.severity)}`}>
            {incident.severity.toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-900">{incident.ruleName}</p>
                <p className="text-xs text-gray-500">{incident.serviceName || 'platform'} · {new Date(incident.firedAt).toLocaleString()}</p>
              </div>
              {incident.runbookUrl && (
                <a
                  href={incident.runbookUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  View recovery playbook
                </a>
              )}
            </div>
            {incident.context && (
              <p className="text-xs text-gray-600 mt-2 truncate">
                Context: {Object.entries(incident.context).map(([key, value]) => `${key}: ${value}`).join(' · ')}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
