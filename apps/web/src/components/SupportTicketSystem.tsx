'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';
import SupportTicketForm from './SupportTicketForm';

const logger = createLogger('SupportTicketSystem');

interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: string;
  updatedAt: string;
  responses?: Array<{
    id: string;
    message: string;
    from: 'user' | 'support';
    createdAt: string;
  }>;
}

interface SupportTicketSystemProps {
  token: string;
}

export default function SupportTicketSystem({ token }: SupportTicketSystemProps) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [newResponse, setNewResponse] = useState('');

  useEffect(() => {
    loadTickets();
  }, [filter]);

  const loadTickets = async () => {
    setLoading(true);
    try {
      const url = filter === 'all' 
        ? '/api/support/tickets'
        : `/api/support/tickets?status=${filter === 'open' ? 'open,in_progress' : 'resolved,closed'}`;
      
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load tickets');

      const data = await response.json();
      setTickets(data.tickets || []);
    } catch (error) {
      logger.error('Failed to load tickets', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTicketDetails = async (ticketId: string) => {
    try {
      const response = await fetch(`/api/support/tickets/${ticketId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load ticket details');

      const data = await response.json();
      setSelectedTicket(data.ticket);
    } catch (error) {
      logger.error('Failed to load ticket details', error);
    }
  };

  const handleSubmitTicket = async (subject: string, description: string, priority: string) => {
    try {
      const response = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ subject, description, priority }),
      });

      if (!response.ok) throw new Error('Failed to create ticket');

      setShowForm(false);
      await loadTickets();
    } catch (error) {
      logger.error('Failed to create ticket', error);
      alert('Failed to create ticket');
    }
  };

  const addResponse = async () => {
    if (!selectedTicket || !newResponse.trim()) return;

    try {
      const response = await fetch(`/api/support/tickets/${selectedTicket.id}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: newResponse }),
      });

      if (!response.ok) throw new Error('Failed to add response');

      setNewResponse('');
      await loadTicketDetails(selectedTicket.id);
      await loadTickets();
    } catch (error) {
      logger.error('Failed to add response', error);
      alert('Failed to add response');
    }
  };

  const closeTicket = async (ticketId: string) => {
    if (!confirm('Are you sure you want to close this ticket?')) return;

    try {
      const response = await fetch(`/api/support/tickets/${ticketId}/close`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to close ticket');

      await loadTickets();
      if (selectedTicket?.id === ticketId) {
        setSelectedTicket(null);
      }
    } catch (error) {
      logger.error('Failed to close ticket', error);
      alert('Failed to close ticket');
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default:
        return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-blue-100 text-blue-800';
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800';
      case 'resolved':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Support Ticket System</h2>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          New Ticket
        </button>
      </div>

      {showForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="font-semibold mb-3">Create New Support Ticket</h3>
          <SupportTicketForm
            onSubmit={handleSubmitTicket}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('open')}
          className={`px-4 py-2 rounded ${filter === 'open' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
        >
          Open
        </button>
        <button
          onClick={() => setFilter('resolved')}
          className={`px-4 py-2 rounded ${filter === 'resolved' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
        >
          Resolved
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold mb-3">Tickets ({tickets.length})</h3>
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading tickets...</div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No tickets found</div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    selectedTicket?.id === ticket.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => {
                    setSelectedTicket(ticket);
                    loadTicketDetails(ticket.id);
                  }}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-semibold">{ticket.subject}</h4>
                    <span className={`text-xs px-2 py-1 rounded ${getStatusColor(ticket.status)}`}>
                      {ticket.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-2 line-clamp-2">{ticket.description}</p>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded ${getPriorityColor(ticket.priority)}`}>
                      {ticket.priority.toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(ticket.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedTicket && (
          <div>
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold">Ticket Details</h3>
              {selectedTicket.status !== 'closed' && (
                <button
                  onClick={() => closeTicket(selectedTicket.id)}
                  className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Close Ticket
                </button>
              )}
            </div>
            <div className="border rounded-lg p-4 space-y-4 max-h-[600px] overflow-y-auto">
              <div>
                <h4 className="font-semibold mb-2">{selectedTicket.subject}</h4>
                <p className="text-sm text-gray-700 mb-3">{selectedTicket.description}</p>
                <div className="flex gap-2">
                  <span className={`text-xs px-2 py-1 rounded ${getPriorityColor(selectedTicket.priority)}`}>
                    {selectedTicket.priority.toUpperCase()}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded ${getStatusColor(selectedTicket.status)}`}>
                    {selectedTicket.status.toUpperCase()}
                  </span>
                </div>
              </div>

              {selectedTicket.responses && selectedTicket.responses.length > 0 && (
                <div className="space-y-3 pt-4 border-t">
                  <h5 className="font-medium">Conversation</h5>
                  {selectedTicket.responses.map((response) => (
                    <div
                      key={response.id}
                      className={`p-3 rounded ${
                        response.from === 'user' ? 'bg-blue-50' : 'bg-gray-50'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-xs font-medium">
                          {response.from === 'user' ? 'You' : 'Support Team'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(response.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm">{response.message}</p>
                    </div>
                  ))}
                </div>
              )}

              {selectedTicket.status !== 'closed' && (
                <div className="pt-4 border-t">
                  <textarea
                    value={newResponse}
                    onChange={(e) => setNewResponse(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md mb-2"
                    rows={3}
                    placeholder="Add a response..."
                  />
                  <button
                    onClick={addResponse}
                    disabled={!newResponse.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    Send Response
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
