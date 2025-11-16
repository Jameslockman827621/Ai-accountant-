import { createLogger } from '@ai-accountant/shared-utils';
import axios from 'axios';

const logger = createLogger('fx-conversion');

// Cache for exchange rates (in production, use Redis)
const rateCache = new Map<string, { rate: number; timestamp: number }>();
const CACHE_TTL = 3600000; // 1 hour

// Fallback rates (updated periodically, but not real-time)
const FALLBACK_RATES: Record<string, number> = {
  'GBP/USD': 1.27,
  'GBP/EUR': 1.17,
  'USD/EUR': 0.92,
  'EUR/USD': 1.09,
  'USD/GBP': 0.79,
  'EUR/GBP': 0.85,
  'GBP/SEK': 13.2,
  'GBP/DKK': 8.7,
  'EUR/SEK': 11.3,
  'EUR/DKK': 7.4,
  'USD/SEK': 10.4,
  'USD/DKK': 6.8,
};

export interface ExchangeRate {
  from: string;
  to: string;
  rate: number;
  timestamp: number;
  source: 'api' | 'cache' | 'fallback';
}

export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  useAPI: boolean = false
): Promise<ExchangeRate | null> {
  if (fromCurrency === toCurrency) {
    return {
      from: fromCurrency,
      to: toCurrency,
      rate: 1.0,
      timestamp: Date.now(),
      source: 'cache',
    };
  }

  const cacheKey = `${fromCurrency}/${toCurrency}`;
  const cached = rateCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return {
      from: fromCurrency,
      to: toCurrency,
      rate: cached.rate,
      timestamp: cached.timestamp,
      source: 'cache',
    };
  }

  // Try to get inverse rate from cache
  const inverseKey = `${toCurrency}/${fromCurrency}`;
  const inverseCached = rateCache.get(inverseKey);
  if (inverseCached && Date.now() - inverseCached.timestamp < CACHE_TTL) {
    const rate = 1 / inverseCached.rate;
    rateCache.set(cacheKey, { rate, timestamp: inverseCached.timestamp });
    return {
      from: fromCurrency,
      to: toCurrency,
      rate,
      timestamp: inverseCached.timestamp,
      source: 'cache',
    };
  }

  // Try API if enabled
  if (useAPI && process.env.EXCHANGE_RATE_API_KEY) {
    try {
      // Using exchangerate-api.com as an example (free tier available)
      const response = await axios.get(
        `https://v6.exchangerate-api.com/v6/${process.env.EXCHANGE_RATE_API_KEY}/pair/${fromCurrency}/${toCurrency}`
      );

      if (response.data && response.data.conversion_rate) {
        const rate = response.data.conversion_rate;
        rateCache.set(cacheKey, { rate, timestamp: Date.now() });
        return {
          from: fromCurrency,
          to: toCurrency,
          rate,
          timestamp: Date.now(),
          source: 'api',
        };
      }
    } catch (error) {
      logger.warn('Failed to fetch exchange rate from API', error);
    }
  }

  // Use fallback rates
  const fallbackKey = `${fromCurrency}/${toCurrency}`;
  const fallbackRate = FALLBACK_RATES[fallbackKey];
  
  if (fallbackRate) {
    rateCache.set(cacheKey, { rate: fallbackRate, timestamp: Date.now() });
    return {
      from: fromCurrency,
      to: toCurrency,
      rate: fallbackRate,
      timestamp: Date.now(),
      source: 'fallback',
    };
  }

  // Try inverse fallback
  const inverseFallbackKey = `${toCurrency}/${fromCurrency}`;
  const inverseFallbackRate = FALLBACK_RATES[inverseFallbackKey];
  if (inverseFallbackRate) {
    const rate = 1 / inverseFallbackRate;
    rateCache.set(cacheKey, { rate, timestamp: Date.now() });
    return {
      from: fromCurrency,
      to: toCurrency,
      rate,
      timestamp: Date.now(),
      source: 'fallback',
    };
  }

  logger.warn(`No exchange rate found for ${fromCurrency}/${toCurrency}`);
  return null;
}

export async function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  useAPI: boolean = false
): Promise<number | null> {
  const rate = await getExchangeRate(fromCurrency, toCurrency, useAPI);
  if (!rate) {
    return null;
  }

  return Math.round(amount * rate * 100) / 100;
}

export function getSupportedCurrencies(): string[] {
  return ['GBP', 'USD', 'EUR', 'SEK', 'DKK', 'CHF', 'JPY', 'CAD', 'AUD', 'NZD'];
}

export function clearRateCache(): void {
  rateCache.clear();
}
