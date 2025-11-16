'use client';

import React from 'react';

interface Tier {
  id: string;
  name: string;
  price: number;
  features: string[];
  limits: {
    documents: number;
    storage: number;
  };
}

interface UpgradePromptProps {
  currentTier: string;
  targetTier?: string;
  reason?: 'limit_reached' | 'feature_unavailable' | 'usage_high' | 'general';
  onUpgrade?: (tierId: string) => void;
  onDismiss?: () => void;
}

const TIERS: Record<string, Tier> = {
  freelancer: {
    id: 'freelancer',
    name: 'Freelancer',
    price: 29,
    features: ['100 documents/month', '1GB storage', 'Basic support'],
    limits: { documents: 100, storage: 1_000_000_000 },
  },
  sme: {
    id: 'sme',
    name: 'SME',
    price: 99,
    features: ['500 documents/month', '5GB storage', 'Priority support', 'Advanced reporting'],
    limits: { documents: 500, storage: 5_000_000_000 },
  },
  accountant: {
    id: 'accountant',
    name: 'Accountant',
    price: 299,
    features: ['2000 documents/month', '20GB storage', 'Dedicated support', 'Multi-client management'],
    limits: { documents: 2000, storage: 20_000_000_000 },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 999,
    features: ['Unlimited documents', 'Unlimited storage', 'Custom integrations', 'SLA guarantee'],
    limits: { documents: -1, storage: -1 },
  },
};

export default function UpgradePrompt({
  currentTier,
  targetTier,
  reason = 'general',
  onUpgrade,
  onDismiss,
}: UpgradePromptProps) {
  const currentTierData = TIERS[currentTier];
  const nextTierId = targetTier || getNextTier(currentTier);
  const nextTierData = TIERS[nextTierId];

  function getNextTier(tier: string): string {
    const tierOrder = ['freelancer', 'sme', 'accountant', 'enterprise'];
    const currentIndex = tierOrder.indexOf(tier);
    return currentIndex < tierOrder.length - 1 ? tierOrder[currentIndex + 1] : tierOrder[tierOrder.length - 1];
  }

  const getReasonMessage = () => {
    switch (reason) {
      case 'limit_reached':
        return 'You\'ve reached your plan limit. Upgrade to continue processing documents.';
      case 'feature_unavailable':
        return 'This feature is not available on your current plan.';
      case 'usage_high':
        return 'You\'re using a lot of your plan\'s resources. Consider upgrading for more capacity.';
      default:
        return 'Upgrade to unlock more features and higher limits.';
    }
  };

  if (!nextTierData) {
    return null; // Already on highest tier
  }

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg shadow-lg p-6 border-2 border-blue-200">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h3 className="text-xl font-bold text-gray-900 mb-2">🚀 Upgrade Your Plan</h3>
          <p className="text-gray-700 mb-4">{getReasonMessage()}</p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-600 mb-1">Current Plan</p>
          <p className="text-lg font-bold">{currentTierData.name}</p>
          <p className="text-2xl font-bold text-gray-900">£{currentTierData.price}/mo</p>
        </div>
        <div className="bg-blue-100 p-4 rounded-lg border-2 border-blue-400">
          <p className="text-sm text-blue-800 mb-1">Upgrade To</p>
          <p className="text-lg font-bold text-blue-900">{nextTierData.name}</p>
          <p className="text-2xl font-bold text-blue-900">£{nextTierData.price}/mo</p>
        </div>
      </div>

      <div className="mb-4">
        <p className="text-sm font-medium text-gray-700 mb-2">What you'll get:</p>
        <ul className="space-y-1">
          {nextTierData.features.map((feature, index) => (
            <li key={index} className="flex items-center gap-2 text-sm text-gray-700">
              <span className="text-green-600">✓</span>
              {feature}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => onUpgrade && onUpgrade(nextTierId)}
          className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors"
        >
          Upgrade to {nextTierData.name}
        </button>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Maybe Later
          </button>
        )}
      </div>
    </div>
  );
}
