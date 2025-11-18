import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('billing-service');

export interface TierLimits {
  documentsPerMonth: number;
  ocrRequestsPerMonth: number;
  llmQueriesPerMonth: number;
  filingsPerMonth: number;
  storageGB: number;
  bankConnections: number;
  clients?: number; // For accountant tier
}

const TIER_LIMITS: Record<string, TierLimits> = {
  freelancer: {
    documentsPerMonth: 100,
    ocrRequestsPerMonth: 100,
    llmQueriesPerMonth: 500,
    filingsPerMonth: 12,
    storageGB: 5,
    bankConnections: 2,
  },
  sme: {
    documentsPerMonth: 1000,
    ocrRequestsPerMonth: 1000,
    llmQueriesPerMonth: 5000,
    filingsPerMonth: 50,
    storageGB: 50,
    bankConnections: 10,
  },
  accountant: {
    documentsPerMonth: 10000,
    ocrRequestsPerMonth: 10000,
    llmQueriesPerMonth: 50000,
    filingsPerMonth: 500,
    storageGB: 500,
    bankConnections: 100,
    clients: 50,
  },
  enterprise: {
    documentsPerMonth: 100000,
    ocrRequestsPerMonth: 100000,
    llmQueriesPerMonth: 500000,
    filingsPerMonth: 5000,
    storageGB: 5000,
    bankConnections: 1000,
    clients: 1000,
  },
};

export interface UsageCheck {
  allowed: boolean;
  reason?: string;
  currentUsage: number;
  limit: number;
  remaining: number;
}

/**
 * Enforce tier limits and usage-based billing
 */
export async function checkUsageLimit(
  tenantId: TenantId,
  resourceType: 'documents' | 'ocr' | 'llm' | 'filings' | 'storage' | 'bank_connections' | 'clients'
): Promise<UsageCheck> {
  // Get tenant tier
  const tenantResult = await db.query<{
    subscription_tier: string;
  }>(
    `SELECT subscription_tier
     FROM tenants
     WHERE id = $1`,
    [tenantId]
  );

  const tenantRow = tenantResult.rows[0];
  if (!tenantRow) {
    throw new Error('Tenant not found');
  }

  const tier = (tenantRow.subscription_tier as keyof typeof TIER_LIMITS) ?? 'freelancer';
  const limits = TIER_LIMITS[tier] ?? TIER_LIMITS.freelancer;

  // Get current period usage
  const currentPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM

  const usageResult = await db.query<{
    documents_processed: number;
    ocr_requests: number;
    llm_queries: number;
    filings_submitted: number;
    storage_used: number;
  }>(
    `SELECT 
       documents_processed, ocr_requests, llm_queries,
       filings_submitted, storage_used
     FROM usage_metrics
     WHERE tenant_id = $1 AND period = $2`,
    [tenantId, currentPeriod]
  );

  const usage = usageResult.rows[0] || {
    documents_processed: 0,
    ocr_requests: 0,
    llm_queries: 0,
    filings_submitted: 0,
    storage_used: 0,
  };

  // Map resource type to limit and usage
  let limit: number;
  let currentUsage: number;

    switch (resourceType) {
      case 'documents':
        limit = limits.documentsPerMonth;
        currentUsage = toNumber(usage.documents_processed);
        break;
      case 'ocr':
        limit = limits.ocrRequestsPerMonth;
        currentUsage = toNumber(usage.ocr_requests);
        break;
      case 'llm':
        limit = limits.llmQueriesPerMonth;
        currentUsage = toNumber(usage.llm_queries);
        break;
      case 'filings':
        limit = limits.filingsPerMonth;
        currentUsage = toNumber(usage.filings_submitted);
        break;
      case 'storage':
        limit = limits.storageGB;
        currentUsage = toNumber(usage.storage_used);
        break;
      case 'bank_connections': {
        limit = limits.bankConnections;
        const connResult = await db.query<{ count: number }>(
          `SELECT COUNT(*) as count
           FROM bank_connections
           WHERE tenant_id = $1 AND is_active = true`,
          [tenantId]
        );
        currentUsage = toNumber(connResult.rows[0]?.count);
        break;
      }
      case 'clients': {
        limit = limits.clients || 0;
        const clientsResult = await db.query<{ count: number }>(
          `SELECT COUNT(*) as count
           FROM tenants
           WHERE metadata->>'parent_tenant_id' = $1`,
          [tenantId]
        );
        currentUsage = toNumber(clientsResult.rows[0]?.count);
        break;
      }
      default:
        throw new Error(`Unknown resource type: ${resourceType}`);
    }

    const allowed = currentUsage < limit;
    const remaining = Math.max(0, limit - currentUsage);

    const usageCheck: UsageCheck = {
      allowed,
      currentUsage,
      limit,
      remaining,
    };

    if (!allowed) {
      usageCheck.reason = `Limit reached for ${resourceType}. Current: ${currentUsage}, Limit: ${limit}`;
    }

    return usageCheck;
}

/**
 * Record usage for a resource
 */
export async function recordUsage(
  tenantId: TenantId,
  resourceType: 'documents' | 'ocr' | 'llm' | 'filings' | 'storage',
  amount: number = 1
): Promise<void> {
  const currentPeriod = new Date().toISOString().slice(0, 7);

  const fieldMap: Record<string, string> = {
    documents: 'documents_processed',
    ocr: 'ocr_requests',
    llm: 'llm_queries',
    filings: 'filings_submitted',
    storage: 'storage_used',
  };

  const field = fieldMap[resourceType];
  if (!field) {
    throw new Error(`Unknown resource type: ${resourceType}`);
  }

  await db.query(
    `INSERT INTO usage_metrics (
      id, tenant_id, period, ${field}, created_at, updated_at
    ) VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())
    ON CONFLICT (tenant_id, period) DO UPDATE
    SET ${field} = usage_metrics.${field} + $3,
        updated_at = NOW()`,
    [tenantId, currentPeriod, amount]
  );

  logger.debug('Usage recorded', { tenantId, resourceType, amount, period: currentPeriod });
}

function toNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}
