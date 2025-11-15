'use client';

import { useCallback, useEffect, useState } from 'react';
import SupportTicketForm from './SupportTicketForm';

interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: string;
}

interface SupportCenterPanelProps {
  token: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function SupportCenterPanel({ token }: SupportCenterPanelProps) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE}/api/support/tickets?status=open`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error(`Tickets fetch failed (${response.status})`);
      }
      const data = await response.json() as { tickets: SupportTicket[] };
      setTickets(
        (data.tickets || []).map(ticket => ({
          ...ticket,
          createdAt: ticket.createdAt,
        }))
      );
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load support tickets');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchTickets();
  }, [fetchTickets]);

  const handleSubmitTicket = async (subject: string, description: string, priority: string) => {
    try {
      setSubmitting(true);
      const response = await fetch(`${API_BASE}/api/support/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ subject, description, priority }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Create ticket failed (${response.status})`);
      }

      setShowForm(false);
      await fetchTickets();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to submit support ticket');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="bg-white rounded-lg shadow p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Support Center</h3>
          <p className="text-sm text-gray-500">
            Track open tickets and raise new requests to the support team.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          New ticket
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}

      {showForm && (
        <div className="border rounded-lg p-4 bg-gray-50">
          <SupportTicketForm
            onSubmit={(subject, description, priority) => handleSubmitTicket(subject, description, priority)}
            onCancel={() => setShowForm(false)}
          />
          {submitting && <p className="text-xs text-gray-500 mt-2">Submitting ticket…</p>}
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
          Open tickets
        </h4>
        {loading ? (
          <p className="text-sm text-gray-500">Loading tickets…</p>
        ) : tickets.length === 0 ? (
          <p className="text-sm text-gray-500">No open tickets. Everything looks good!</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2 pr-4">Subject</th>
                  <th className="py-2 pr-4">Priority</th>
                  <th className="py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tickets.map(ticket => (
                  <tr key={ticket.id}>
                    <td className="py-3 pr-4">
                      {new Date(ticket.createdAt).toLocaleString('en-GB')}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-gray-900">{ticket.subject}</div>
                      <div className="text-xs text-gray-500 line-clamp-2">{ticket.description}</div>
                    </td>
                    <td className="py-3 pr-4 capitalize">{ticket.priority}</td>
                    <td className="py-3 pr-4">
                      <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-700 uppercase tracking-wide">
                        {ticket.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
