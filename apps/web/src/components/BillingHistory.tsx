'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';
import { toError } from '@/utils/error';

const logger = createLogger('BillingHistory');

interface Invoice {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  tax: number;
  total: number;
  paidAt?: string;
}

export default function BillingHistory() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    loadInvoices();
  }, []);

  const loadInvoices = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/billing/invoices', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load invoices');

      const data = await response.json();
      setInvoices(data.invoices || []);
    } catch (error) {
      const err = toError(error, 'Failed to load invoices');
      logger.error('Failed to load invoices', err);
    } finally {
      setLoading(false);
    }
  };

  const downloadInvoice = async (invoiceId: string) => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/billing/invoices/${invoiceId}/download`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to download invoice');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      const err = toError(error, 'Failed to download invoice');
      logger.error('Failed to download invoice', err);
      alert('Failed to download invoice');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-800';
      case 'overdue':
        return 'bg-red-100 text-red-800';
      case 'sent':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading invoices...</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Billing History</h2>
        <button
          onClick={loadInvoices}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Refresh
        </button>
      </div>

      {invoices.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No invoices found
        </div>
      ) : (
        <div className="space-y-4">
          {invoices.map((invoice) => (
            <div
              key={invoice.id}
              className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer"
              onClick={() => setSelectedInvoice(invoice)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="font-semibold">{invoice.invoiceNumber}</p>
                    <span className={`px-2 py-1 rounded text-xs ${getStatusColor(invoice.status)}`}>
                      {invoice.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">
                    Issued: {new Date(invoice.issueDate).toLocaleDateString()}
                  </p>
                  <p className="text-sm text-gray-600">
                    Due: {new Date(invoice.dueDate).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold">£{invoice.total.toLocaleString()}</p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadInvoice(invoice.id);
                    }}
                    className="mt-2 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Download
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Invoice Details</h3>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Invoice Number</p>
                <p className="font-semibold">{selectedInvoice.invoiceNumber}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Issue Date</p>
                  <p>{new Date(selectedInvoice.issueDate).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Due Date</p>
                  <p>{new Date(selectedInvoice.dueDate).toLocaleDateString()}</p>
                </div>
              </div>

              <div>
                <p className="font-semibold mb-2">Line Items</p>
                <div className="space-y-2">
                  {selectedInvoice.lineItems.map((item, i) => (
                    <div key={i} className="flex justify-between p-2 bg-gray-50 rounded">
                      <div>
                        <p className="font-medium">{item.description}</p>
                        <p className="text-sm text-gray-600">
                          {item.quantity} × £{item.unitPrice.toFixed(2)}
                        </p>
                      </div>
                      <p className="font-semibold">£{item.total.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex justify-between mb-2">
                  <p>Subtotal</p>
                  <p>£{selectedInvoice.subtotal.toFixed(2)}</p>
                </div>
                <div className="flex justify-between mb-2">
                  <p>Tax (VAT)</p>
                  <p>£{selectedInvoice.tax.toFixed(2)}</p>
                </div>
                <div className="flex justify-between font-bold text-lg border-t pt-2">
                  <p>Total</p>
                  <p>£{selectedInvoice.total.toFixed(2)}</p>
                </div>
              </div>

              {selectedInvoice.paidAt && (
                <div className="p-3 bg-green-50 border border-green-200 rounded">
                  <p className="text-green-800">
                    Paid on {new Date(selectedInvoice.paidAt).toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
