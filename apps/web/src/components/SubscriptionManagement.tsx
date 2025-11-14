import React, { useState, useEffect } from 'react';

interface Subscription {
  tier: 'freelancer' | 'sme' | 'accountant' | 'enterprise';
  status: 'active' | 'cancelled' | 'expired';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

interface Usage {
  documentsProcessed: number;
  ocrRequests: number;
  llmQueries: number;
  filingsSubmitted: number;
  storageUsed: number;
}

export default function SubscriptionManagement() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch subscription and usage
    // In production, this would call the API
    setSubscription({
      tier: 'sme',
      status: 'active',
      currentPeriodStart: '2024-01-01',
      currentPeriodEnd: '2024-02-01',
      cancelAtPeriodEnd: false,
    });
    setUsage({
      documentsProcessed: 150,
      ocrRequests: 150,
      llmQueries: 300,
      filingsSubmitted: 2,
      storageUsed: 50000000, // 50MB
    });
    setLoading(false);
  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!subscription || !usage) {
    return <div>No subscription found</div>;
  }

  const tierLimits: Record<string, { documents: number; storage: number }> = {
    freelancer: { documents: 100, storage: 1000000000 }, // 1GB
    sme: { documents: 500, storage: 5000000000 }, // 5GB
    accountant: { documents: 2000, storage: 20000000000 }, // 20GB
    enterprise: { documents: -1, storage: -1 }, // Unlimited
  };

  const limits = tierLimits[subscription.tier] || tierLimits.freelancer;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-semibold mb-4">Subscription Management</h2>

      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-gray-600">Current Plan</span>
          <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded font-semibold capitalize">
            {subscription.tier}
          </span>
        </div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-gray-600">Status</span>
          <span className={`px-3 py-1 rounded font-semibold ${
            subscription.status === 'active' ? 'bg-green-100 text-green-800' :
            subscription.status === 'cancelled' ? 'bg-red-100 text-red-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {subscription.status}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Billing Period</span>
          <span className="text-sm">
            {new Date(subscription.currentPeriodStart).toLocaleDateString()} - {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
          </span>
        </div>
      </div>

      <div className="mb-6">
        <h3 className="font-semibold mb-3">Usage</h3>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-sm text-gray-600">Documents Processed</span>
              <span className="text-sm font-medium">
                {usage.documentsProcessed} {limits.documents > 0 && `/ ${limits.documents}`}
              </span>
            </div>
            {limits.documents > 0 && (
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full"
                  style={{ width: `${Math.min((usage.documentsProcessed / limits.documents) * 100, 100)}%` }}
                />
              </div>
            )}
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-sm text-gray-600">Storage Used</span>
              <span className="text-sm font-medium">
                {(usage.storageUsed / 1000000).toFixed(2)} MB
                {limits.storage > 0 && ` / ${(limits.storage / 1000000).toFixed(0)} MB`}
              </span>
            </div>
            {limits.storage > 0 && (
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full"
                  style={{ width: `${Math.min((usage.storageUsed / limits.storage) * 100, 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex space-x-2">
        <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          Upgrade Plan
        </button>
        {subscription.status === 'active' && !subscription.cancelAtPeriodEnd && (
          <button className="px-4 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50">
            Cancel Subscription
          </button>
        )}
      </div>
    </div>
  );
}
