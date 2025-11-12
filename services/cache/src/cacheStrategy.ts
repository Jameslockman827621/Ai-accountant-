import { redisCache } from './redis';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('cache-service');

// Cache expensive operations
export class CacheStrategy {
  // Cache chart of accounts (TTL: 1 hour)
  async getChartOfAccounts(tenantId: string): Promise<unknown> {
    const cacheKey = `chart_of_accounts:${tenantId}`;
    const cached = await redisCache.get(cacheKey);
    if (cached) {
      logger.debug('Chart of accounts cache hit', { tenantId });
      return cached;
    }
    return null;
  }

  async setChartOfAccounts(tenantId: string, accounts: unknown): Promise<void> {
    const cacheKey = `chart_of_accounts:${tenantId}`;
    await redisCache.set(cacheKey, accounts, 3600);
    logger.debug('Chart of accounts cached', { tenantId });
  }

  // Cache tax calculations (TTL: 30 minutes)
  async getTaxCalculation(tenantId: string, period: string): Promise<unknown> {
    const cacheKey = `tax_calculation:${tenantId}:${period}`;
    return await redisCache.get(cacheKey);
  }

  async setTaxCalculation(tenantId: string, period: string, calculation: unknown): Promise<void> {
    const cacheKey = `tax_calculation:${tenantId}:${period}`;
    await redisCache.set(cacheKey, calculation, 1800);
  }

  // Cache financial reports (TTL: 15 minutes)
  async getFinancialReport(tenantId: string, reportType: string, period: string): Promise<unknown> {
    const cacheKey = `financial_report:${tenantId}:${reportType}:${period}`;
    return await redisCache.get(cacheKey);
  }

  async setFinancialReport(
    tenantId: string,
    reportType: string,
    period: string,
    report: unknown
  ): Promise<void> {
    const cacheKey = `financial_report:${tenantId}:${reportType}:${period}`;
    await redisCache.set(cacheKey, report, 900);
  }

  // Cache user sessions (TTL: 8 hours)
  async getUserSession(sessionId: string): Promise<unknown> {
    const cacheKey = `user_session:${sessionId}`;
    return await redisCache.get(cacheKey);
  }

  async setUserSession(sessionId: string, session: unknown): Promise<void> {
    const cacheKey = `user_session:${sessionId}`;
    await redisCache.set(cacheKey, session, 28800);
  }

  // Invalidate cache
  async invalidate(pattern: string): Promise<void> {
    // In production, use Redis SCAN to find and delete matching keys
    logger.info('Cache invalidated', { pattern });
  }
}

export const cacheStrategy = new CacheStrategy();
