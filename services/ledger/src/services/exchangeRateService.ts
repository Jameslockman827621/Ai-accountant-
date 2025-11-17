import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { multiEntityService } from './multiEntityService';

const logger = createLogger('exchange-rate-service');

export interface ExchangeRateProvider {
  name: string;
  fetchRate: (fromCurrency: string, toCurrency: string, date: Date) => Promise<number>;
}

/**
 * ECB (European Central Bank) Exchange Rate Provider
 * Free API, no authentication required
 */
export class ECBProvider implements ExchangeRateProvider {
  name = 'ECB';

  async fetchRate(fromCurrency: string, toCurrency: string, date: Date): Promise<number> {
    // ECB provides rates relative to EUR
    if (fromCurrency === 'EUR' && toCurrency === 'EUR') {
      return 1.0;
    }

    try {
      // ECB API endpoint
      const baseUrl = 'https://api.exchangerate.host';
      const dateStr = date.toISOString().split('T')[0];

      // If either currency is EUR, use direct ECB endpoint
      if (fromCurrency === 'EUR') {
        const response = await fetch(`${baseUrl}/${dateStr}?base=EUR&symbols=${toCurrency}`);
        const data = await response.json() as { rates?: Record<string, number> };
        if (data.rates && data.rates[toCurrency]) {
          return data.rates[toCurrency];
        }
      } else if (toCurrency === 'EUR') {
        const response = await fetch(`${baseUrl}/${dateStr}?base=${fromCurrency}&symbols=EUR`);
        const data = await response.json() as { rates?: Record<string, number> };
        if (data.rates && data.rates.EUR) {
          return 1 / data.rates.EUR; // Inverse for EUR as target
        }
      } else {
        // Both non-EUR: convert via EUR
        const fromToEur = await this.fetchRate(fromCurrency, 'EUR', date);
        const eurToTarget = await this.fetchRate('EUR', toCurrency, date);
        return fromToEur * eurToTarget;
      }

      throw new Error(`Rate not found: ${fromCurrency} to ${toCurrency}`);
    } catch (error) {
      logger.error('ECB API fetch failed', {
        fromCurrency,
        toCurrency,
        date,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }
}

/**
 * OANDA Exchange Rate Provider
 * Requires API key
 */
export class OANDAProvider implements ExchangeRateProvider {
  name = 'OANDA';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchRate(fromCurrency: string, toCurrency: string, date: Date): Promise<number> {
    if (fromCurrency === toCurrency) {
      return 1.0;
    }

    try {
      const dateStr = date.toISOString().split('T')[0];
      const pair = `${fromCurrency}_${toCurrency}`;

      // OANDA API endpoint (example - adjust based on actual OANDA API)
      const url = `https://api.exchangerate.host/${dateStr}?base=${fromCurrency}&symbols=${toCurrency}`;

      // For production, use actual OANDA API:
      // const url = `https://api-fxtrade.oanda.com/v3/rates/${pair}?date=${dateStr}`;
      // headers: { 'Authorization': `Bearer ${this.apiKey}` }

      const response = await fetch(url);
      const data = await response.json() as { rates?: Record<string, number> };

      if (data.rates && data.rates[toCurrency]) {
        return data.rates[toCurrency];
      }

      throw new Error(`Rate not found: ${fromCurrency} to ${toCurrency}`);
    } catch (error) {
      logger.error('OANDA API fetch failed', {
        fromCurrency,
        toCurrency,
        date,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }
}

/**
 * Manual Exchange Rate Provider (for custom/manual rates)
 */
export class ManualProvider implements ExchangeRateProvider {
  name = 'manual';

  async fetchRate(fromCurrency: string, toCurrency: string, date: Date): Promise<number> {
    // Manual provider requires rates to be stored in database first
    const { db } = await import('@ai-accountant/database');
    const result = await db.query<{ rate: number }>(
      `SELECT rate FROM exchange_rates
       WHERE from_currency = $1 AND to_currency = $2 AND rate_date = $3
         AND rate_type = 'spot' AND source = 'manual'
       ORDER BY created_at DESC LIMIT 1`,
      [fromCurrency, toCurrency, date]
    );

    if (result.rows.length > 0) {
      return parseFloat(result.rows[0].rate.toString());
    }

    throw new Error(`Manual rate not found: ${fromCurrency} to ${toCurrency} for ${date}`);
  }
}

export class ExchangeRateService {
  private providers: ExchangeRateProvider[] = [];
  private defaultProvider: ExchangeRateProvider;

  constructor() {
    // Initialize providers
    this.providers.push(new ECBProvider());

    // Add OANDA if API key is available
    const oandaApiKey = process.env.OANDA_API_KEY;
    if (oandaApiKey) {
      this.providers.push(new OANDAProvider(oandaApiKey));
    }

    this.providers.push(new ManualProvider());

    // Default to ECB (free, no auth required)
    this.defaultProvider = this.providers.find((p) => p.name === 'ECB') || this.providers[0];
  }

  /**
   * Get exchange rate, fetching from provider if not in database
   */
  async getExchangeRate(
    tenantId: TenantId,
    fromCurrency: string,
    toCurrency: string,
    date: Date,
    options?: {
      provider?: string;
      forceRefresh?: boolean;
    }
  ): Promise<number> {
    if (fromCurrency === toCurrency) {
      return 1.0;
    }

    // Check database first (unless force refresh)
    if (!options?.forceRefresh) {
      const cachedResult = await db.query<{ rate: number }>(
        `SELECT rate FROM exchange_rates
         WHERE tenant_id = $1
           AND from_currency = $2
           AND to_currency = $3
           AND rate_date = $4
           AND rate_type = 'spot'
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, fromCurrency, toCurrency, date]
      );

      if (cachedResult.rows.length > 0) {
        return parseFloat(cachedResult.rows[0].rate.toString());
      }
    }

    // Fetch from provider
    const providerName = options?.provider || 'ECB';
    const provider = this.providers.find((p) => p.name === providerName) || this.defaultProvider;

    logger.info('Fetching exchange rate from provider', {
      tenantId,
      fromCurrency,
      toCurrency,
      date,
      provider: provider.name,
    });

    try {
      const rate = await provider.fetchRate(fromCurrency, toCurrency, date);

      // Store in database
      await multiEntityService.storeExchangeRate(
        tenantId,
        fromCurrency,
        toCurrency,
        date,
        rate,
        'spot',
        provider.name
      );

      return rate;
    } catch (error) {
      logger.error('Failed to fetch exchange rate', {
        tenantId,
        fromCurrency,
        toCurrency,
        date,
        provider: provider.name,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      // Try fallback to manual if available
      if (provider.name !== 'manual') {
        try {
          const manualProvider = new ManualProvider();
          return await manualProvider.fetchRate(fromCurrency, toCurrency, date);
        } catch {
          // Ignore fallback error
        }
      }

      throw error;
    }
  }

  /**
   * Batch fetch exchange rates for multiple currency pairs
   */
  async getExchangeRates(
    tenantId: TenantId,
    pairs: Array<{ fromCurrency: string; toCurrency: string; date: Date }>,
    options?: { provider?: string; forceRefresh?: boolean }
  ): Promise<Record<string, number>> {
    const rates: Record<string, number> = {};

    // Fetch in parallel (with rate limiting)
    const batchSize = 10;
    for (let i = 0; i < pairs.length; i += batchSize) {
      const batch = pairs.slice(i, i + batchSize);
      const batchRates = await Promise.all(
        batch.map(async (pair) => {
          const key = `${pair.fromCurrency}_${pair.toCurrency}_${pair.date.toISOString().split('T')[0]}`;
          try {
            const rate = await this.getExchangeRate(
              tenantId,
              pair.fromCurrency,
              pair.toCurrency,
              pair.date,
              options
            );
            return { key, rate };
          } catch (error) {
            logger.error('Failed to fetch rate for pair', {
              pair,
              error: error instanceof Error ? error : new Error(String(error)),
            });
            return { key, rate: null };
          }
        })
      );

      batchRates.forEach(({ key, rate }) => {
        if (rate !== null) {
          rates[key] = rate;
        }
      });

      // Rate limiting: wait 100ms between batches
      if (i + batchSize < pairs.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return rates;
  }

  /**
   * Sync exchange rates for a date range
   */
  async syncExchangeRates(
    tenantId: TenantId,
    baseCurrency: string,
    targetCurrencies: string[],
    startDate: Date,
    endDate: Date,
    options?: { provider?: string }
  ): Promise<{ synced: number; failed: number }> {
    const dates: Date[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    let synced = 0;
    let failed = 0;

    for (const date of dates) {
      for (const targetCurrency of targetCurrencies) {
        try {
          await this.getExchangeRate(tenantId, baseCurrency, targetCurrency, date, {
            provider: options?.provider,
            forceRefresh: false,
          });
          synced++;
        } catch (error) {
          logger.error('Failed to sync rate', {
            tenantId,
            baseCurrency,
            targetCurrency,
            date,
            error: error instanceof Error ? error : new Error(String(error)),
          });
          failed++;
        }
      }
    }

    logger.info('Exchange rate sync completed', {
      tenantId,
      baseCurrency,
      targetCurrencies,
      dateRange: { startDate, endDate },
      synced,
      failed,
    });

    return { synced, failed };
  }
}

export const exchangeRateService = new ExchangeRateService();
