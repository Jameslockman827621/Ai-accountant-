import { cacheStrategy } from './cacheStrategy';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('cache-service');

// Apply caching to all expensive operations
export async function getCachedChartOfAccounts(tenantId: TenantId): Promise<unknown> {
  const cached = await cacheStrategy.getChartOfAccounts(tenantId);
  if (cached) {
    return cached;
  }

  // Fetch from database
  const result = await db.query(
    'SELECT * FROM chart_of_accounts WHERE tenant_id = $1',
    [tenantId]
  );

  const accounts = result.rows;
  await cacheStrategy.setChartOfAccounts(tenantId, accounts);
  return accounts;
}

export async function getCachedTaxCalculation(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<unknown> {
  const period = `${periodStart.toISOString()}_${periodEnd.toISOString()}`;
  const cached = await cacheStrategy.getTaxCalculation(tenantId, period);
  if (cached) {
    return cached;
  }

  // Calculate tax (would call actual calculation)
  // In production, this would call the rules engine or filing service
  const calculation = {
    periodStart,
    periodEnd,
    totalTax: 0,
    breakdown: {},
  };
  await cacheStrategy.setTaxCalculation(tenantId, period, calculation);
  return calculation;
}

export async function getCachedFinancialReport(
  tenantId: TenantId,
  reportType: string,
  periodStart: Date,
  periodEnd: Date
): Promise<unknown> {
  const period = `${periodStart.toISOString()}_${periodEnd.toISOString()}`;
  const cached = await cacheStrategy.getFinancialReport(tenantId, reportType, period);
  if (cached) {
    return cached;
  }

  // Generate report (would call actual generation)
  // In production, this would call the reporting service
  const report = {
    reportType,
    periodStart,
    periodEnd,
    data: {},
  };
  await cacheStrategy.setFinancialReport(tenantId, reportType, period, report);
  return report;
}

// Cache invalidation helpers
export async function invalidateTenantCache(tenantId: TenantId): Promise<void> {
  await cacheStrategy.invalidate(`*:${tenantId}:*`);
  logger.info('Tenant cache invalidated', { tenantId });
}

export async function invalidateTaxCache(tenantId: TenantId): Promise<void> {
  await cacheStrategy.invalidate(`tax_calculation:${tenantId}:*`);
  logger.info('Tax cache invalidated', { tenantId });
}
