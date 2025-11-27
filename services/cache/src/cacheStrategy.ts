import { redisCache } from './redis';
import { createLogger } from '@ai-accountant/shared-utils';
import { createHash } from 'crypto';

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

  // Cache ledger reads (TTL: 5 minutes)
  async getLedgerEntriesCache(tenantId: string, filters: Record<string, unknown>): Promise<unknown> {
    const cacheKey = this.buildFilterCacheKey('ledger_entries', tenantId, filters);
    return await redisCache.get(cacheKey);
  }

  async setLedgerEntriesCache(
    tenantId: string,
    filters: Record<string, unknown>,
    payload: unknown
  ): Promise<void> {
    const cacheKey = this.buildFilterCacheKey('ledger_entries', tenantId, filters);
    await redisCache.set(cacheKey, payload, 300);
  }

  async getLedgerBalanceCache(tenantId: string, accountCode: string, asOfDate?: string): Promise<unknown> {
    const cacheKey = `ledger_balance:${tenantId}:${accountCode}:${asOfDate || 'latest'}`;
    return await redisCache.get(cacheKey);
  }

  async setLedgerBalanceCache(
    tenantId: string,
    accountCode: string,
    payload: unknown,
    asOfDate?: string
  ): Promise<void> {
    const cacheKey = `ledger_balance:${tenantId}:${accountCode}:${asOfDate || 'latest'}`;
    await redisCache.set(cacheKey, payload, 300);
  }

  // Cache filings (TTL: 10 minutes)
  async getFilingListCache(tenantId: string, filters: Record<string, unknown>): Promise<unknown> {
    const cacheKey = this.buildFilterCacheKey('filings', tenantId, filters);
    return await redisCache.get(cacheKey);
  }

  async setFilingListCache(tenantId: string, filters: Record<string, unknown>, payload: unknown): Promise<void> {
    const cacheKey = this.buildFilterCacheKey('filings', tenantId, filters);
    await redisCache.set(cacheKey, payload, 600);
  }

  async getFilingStatusCache(filingId: string): Promise<unknown> {
    return await redisCache.get(`filing_status:${filingId}`);
  }

  async setFilingStatusCache(filingId: string, payload: unknown): Promise<void> {
    await redisCache.set(`filing_status:${filingId}`, payload, 600);
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
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
    const keys = redisCache.getKeys();
    await Promise.all(
      keys
        .filter((key) => regex.test(key))
        .map(async (key) => {
          await redisCache.del(key);
        })
    );
    logger.info('Cache invalidated', { pattern, deleted: keys.filter((key) => regex.test(key)).length });
  }

  private buildFilterCacheKey(namespace: string, tenantId: string, filters: Record<string, unknown>): string {
    const hash = createHash('sha256').update(JSON.stringify(filters)).digest('hex');
    return `${namespace}:${tenantId}:${hash}`;
  }
}

export const cacheStrategy = new CacheStrategy();
