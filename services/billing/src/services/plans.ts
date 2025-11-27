import { TierLimits } from './usageEnforcement';

export type BillingInterval = 'monthly' | 'yearly';

export interface SubscriptionPlan {
  tier: 'freelancer' | 'sme' | 'accountant' | 'enterprise';
  name: string;
  price: number;
  currency: string;
  interval: BillingInterval;
  description: string;
  limits: TierLimits;
  features: string[];
}

const BASE_LIMITS: TierLimits = {
  documentsPerMonth: 0,
  ocrRequestsPerMonth: 0,
  llmQueriesPerMonth: 0,
  filingsPerMonth: 0,
  storageGB: 0,
  bankConnections: 0,
};

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    tier: 'freelancer',
    name: 'Freelancer',
    price: 29,
    currency: 'GBP',
    interval: 'monthly',
    description: 'For independent operators needing core automation',
    limits: {
      ...BASE_LIMITS,
      documentsPerMonth: 100,
      ocrRequestsPerMonth: 100,
      llmQueriesPerMonth: 500,
      filingsPerMonth: 12,
      storageGB: 5,
      bankConnections: 2,
    },
    features: ['Basic automation', 'Email support', 'Single user'],
  },
  {
    tier: 'sme',
    name: 'SME',
    price: 99,
    currency: 'GBP',
    interval: 'monthly',
    description: 'For growing businesses with multi-channel operations',
    limits: {
      ...BASE_LIMITS,
      documentsPerMonth: 1000,
      ocrRequestsPerMonth: 1000,
      llmQueriesPerMonth: 5000,
      filingsPerMonth: 50,
      storageGB: 50,
      bankConnections: 10,
    },
    features: ['Priority support', 'Multi-user', 'Advanced workflows'],
  },
  {
    tier: 'accountant',
    name: 'Accountant',
    price: 249,
    currency: 'GBP',
    interval: 'monthly',
    description: 'For accountants managing multiple clients',
    limits: {
      ...BASE_LIMITS,
      documentsPerMonth: 10000,
      ocrRequestsPerMonth: 10000,
      llmQueriesPerMonth: 50000,
      filingsPerMonth: 500,
      storageGB: 500,
      bankConnections: 100,
      clients: 50,
    },
    features: ['Client workspaces', 'Review workflows', 'Dedicated success'],
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    price: 999,
    currency: 'GBP',
    interval: 'monthly',
    description: 'For enterprises with custom compliance and scale needs',
    limits: {
      ...BASE_LIMITS,
      documentsPerMonth: 100000,
      ocrRequestsPerMonth: 100000,
      llmQueriesPerMonth: 500000,
      filingsPerMonth: 5000,
      storageGB: 5000,
      bankConnections: 1000,
      clients: 1000,
    },
    features: ['Custom SLAs', 'Dedicated CSM', 'Private deployment options'],
  },
];

export function getPlan(tier: SubscriptionPlan['tier']): SubscriptionPlan {
  const plan = SUBSCRIPTION_PLANS.find(p => p.tier === tier);
  if (!plan) {
    throw new Error(`Unknown plan tier: ${tier}`);
  }
  return plan;
}

export function calculateProrationAmount(
  currentTier: SubscriptionPlan['tier'],
  newTier: SubscriptionPlan['tier'],
  daysRemaining: number,
  daysInPeriod: number = 30
): number {
  const currentPlan = getPlan(currentTier);
  const targetPlan = getPlan(newTier);
  if (currentPlan.tier === targetPlan.tier) return 0;

  const unusedValue = (currentPlan.price / daysInPeriod) * daysRemaining;
  const newCost = (targetPlan.price / daysInPeriod) * daysRemaining;
  return Math.max(0, Math.round((newCost - unusedValue) * 100) / 100);
}
