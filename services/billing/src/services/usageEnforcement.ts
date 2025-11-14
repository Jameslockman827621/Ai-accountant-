import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('billing-service');

export interface UsageLimits {
  documents: number;
  ocrRequests: number;
  llmQueries: number;
  storage: number; // bytes
  filings: number;
}

const TIER_LIMITS: Record<string, UsageLimits> = {
  freelancer: {
    documents: 100,
    ocrRequests: 100,
    llmQueries: 500,
    storage: 1000000000, // 1GB
    filings: 12,
  },
  sme: {
    documents: 500,
    ocrRequests: 500,
    llmQueries: 2000,
    storage: 5000000000, // 5GB
    filings: 12,
  },
  accountant: {
    documents: 2000,
    ocrRequests: 2000,
    llmQueries: 10000,
    storage: 20000000000, // 20GB
    filings: 50,
  },
  enterprise: {
    documents: -1, // Unlimited
    ocrRequests: -1,
    llmQueries: -1,
    storage: -1,
    filings: -1,
  },
};

export async function checkUsageLimit(
  tenantId: TenantId,
  limitType: keyof UsageLimits
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  // Get tenant tier
  const tenant = await db.query<{
    subscription_tier: string;
  }>(
    'SELECT subscription_tier FROM tenants WHERE id = $1',
    [tenantId]
  );

  if (tenant.rows.length === 0) {
    throw new Error('Tenant not found');
  }

  const tier = tenant.rows[0].subscription_tier;
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.freelancer;
  const limit = limits[limitType];

  // Unlimited
  if (limit === -1) {
    return { allowed: true, remaining: -1, limit: -1 };
  }

  // Get current usage for the month
  const currentPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM

  const usage = await db.query<{
    documents_processed: number;
    ocr_requests: number;
    llm_queries: number;
    storage_used: number;
    filings_submitted: number;
  }>(
    `SELECT documents_processed, ocr_requests, llm_queries, storage_used, filings_submitted
     FROM usage_metrics
     WHERE tenant_id = $1 AND period = $2`,
    [tenantId, currentPeriod]
  );

  const usageData = usage.rows[0] || {
    documents_processed: 0,
    ocr_requests: 0,
    llm_queries: 0,
    storage_used: 0,
    filings_submitted: 0,
  };

  let currentUsage = 0;
  switch (limitType) {
    case 'documents':
      currentUsage = typeof usageData.documents_processed === 'number'
        ? usageData.documents_processed
        : parseInt(String(usageData.documents_processed || '0'), 10);
      break;
    case 'ocrRequests':
      currentUsage = typeof usageData.ocr_requests === 'number'
        ? usageData.ocr_requests
        : parseInt(String(usageData.ocr_requests || '0'), 10);
      break;
    case 'llmQueries':
      currentUsage = typeof usageData.llm_queries === 'number'
        ? usageData.llm_queries
        : parseInt(String(usageData.llm_queries || '0'), 10);
      break;
    case 'storage':
      currentUsage = typeof usageData.storage_used === 'number'
        ? usageData.storage_used
        : parseInt(String(usageData.storage_used || '0'), 10);
      break;
    case 'filings':
      currentUsage = typeof usageData.filings_submitted === 'number'
        ? usageData.filings_submitted
        : parseInt(String(usageData.filings_submitted || '0'), 10);
      break;
  }

  const remaining = limit - currentUsage;
  const allowed = remaining > 0;

  return { allowed, remaining, limit };
}

export async function incrementUsage(
  tenantId: TenantId,
  limitType: keyof UsageLimits,
  amount: number = 1
): Promise<void> {
  const currentPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM

  let field = '';
  switch (limitType) {
    case 'documents':
      field = 'documents_processed';
      break;
    case 'ocrRequests':
      field = 'ocr_requests';
      break;
    case 'llmQueries':
      field = 'llm_queries';
      break;
    case 'storage':
      field = 'storage_used';
      break;
    case 'filings':
      field = 'filings_submitted';
      break;
  }

  await db.query(
    `INSERT INTO usage_metrics (tenant_id, period, ${field}, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id, period) DO UPDATE
     SET ${field} = usage_metrics.${field} + $3`,
    [tenantId, currentPeriod, amount]
  );

  logger.debug('Usage incremented', { tenantId, limitType, amount });
}
