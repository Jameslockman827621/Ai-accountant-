'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('PaymentMethod');

interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_account';
  last4?: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
  createdAt: string;
}

interface PaymentMethodProps {
  token: string;
  onMethodRemoved?: () => void;
  onDefaultChanged?: () => void;
}

export default function PaymentMethod({
  token,
  onMethodRemoved,
  onDefaultChanged,
}: PaymentMethodProps) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadPaymentMethods();
  }, []);

  const loadPaymentMethods = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/billing/payment-methods', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load payment methods');

      const data = await response.json();
      setMethods(data.paymentMethods || []);
    } catch (error) {
      logger.error('Failed to load payment methods', error);
    } finally {
      setLoading(false);
    }
  };

  const setAsDefault = async (methodId: string) => {
    setProcessing(true);
    try {
      const response = await fetch(`/api/billing/payment-methods/${methodId}/set-default`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to set default payment method');

      if (onDefaultChanged) {
        onDefaultChanged();
      }
      await loadPaymentMethods();
    } catch (error) {
      logger.error('Failed to set default payment method', error);
      alert('Failed to set default payment method');
    } finally {
      setProcessing(false);
    }
  };

  const removeMethod = async (methodId: string) => {
    if (!confirm('Are you sure you want to remove this payment method?')) return;

    setProcessing(true);
    try {
      const response = await fetch(`/api/billing/payment-methods/${methodId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to remove payment method');

      if (onMethodRemoved) {
        onMethodRemoved();
      }
      await loadPaymentMethods();
    } catch (error) {
      logger.error('Failed to remove payment method', error);
      alert('Failed to remove payment method');
    } finally {
      setProcessing(false);
    }
  };

  const handleStripeSetup = async () => {
    // This would typically redirect to Stripe's payment method setup
    // For now, we'll show a message
    try {
      const response = await fetch('/api/billing/payment-methods/setup', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to setup payment method');

      const data = await response.json();
      if (data.setupUrl) {
        window.location.href = data.setupUrl;
      } else {
        alert('Payment method setup initiated. Please check your email for next steps.');
        await loadPaymentMethods();
      }
    } catch (error) {
      logger.error('Failed to setup payment method', error);
      alert('Failed to setup payment method');
    }
  };

  const getCardIcon = (brand?: string) => {
    switch (brand?.toLowerCase()) {
      case 'visa':
        return '💳';
      case 'mastercard':
        return '💳';
      case 'amex':
        return '💳';
      default:
        return '💳';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Payment Methods</h2>
        <button
          onClick={handleStripeSetup}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Add Payment Method
        </button>
      </div>

      {loading && methods.length === 0 ? (
        <div className="text-center py-8 text-gray-500">Loading payment methods...</div>
      ) : methods.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-600 mb-4">No payment methods on file</p>
          <button
            onClick={handleStripeSetup}
            className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Add Your First Payment Method
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {methods.map((method) => (
            <div
              key={method.id}
              className={`p-4 rounded-lg border-2 ${
                method.isDefault
                  ? 'bg-blue-50 border-blue-300'
                  : 'bg-white border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{getCardIcon(method.brand)}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">
                        {method.type === 'card' ? (
                          <>
                            {method.brand && method.brand.charAt(0).toUpperCase() + method.brand.slice(1)}{' '}
                            •••• {method.last4}
                          </>
                        ) : (
                          <>Bank Account •••• {method.last4}</>
                        )}
                      </p>
                      {method.isDefault && (
                        <span className="text-xs px-2 py-1 bg-blue-200 text-blue-900 rounded">
                          DEFAULT
                        </span>
                      )}
                    </div>
                    {method.type === 'card' && method.expiryMonth && method.expiryYear && (
                      <p className="text-sm text-gray-600">
                        Expires {method.expiryMonth}/{method.expiryYear}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      Added {new Date(method.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {!method.isDefault && (
                    <button
                      onClick={() => setAsDefault(method.id)}
                      disabled={processing}
                      className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50"
                    >
                      Set Default
                    </button>
                  )}
                  {!method.isDefault && (
                    <button
                      onClick={() => removeMethod(method.id)}
                      disabled={processing}
                      className="px-3 py-1 text-sm bg-red-200 text-red-700 rounded hover:bg-red-300 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-sm text-gray-600">
          <strong>Note:</strong> Payment methods are securely stored and processed by Stripe.
          We never store your full card details.
        </p>
      </div>
    </div>
  );
}
