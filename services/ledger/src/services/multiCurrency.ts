import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import axios from 'axios';

const logger = createLogger('ledger-service');

export interface ExchangeRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  date: Date;
  source: string;
}

const RATE_CACHE: Map<string, { rate: number; expiresAt: Date }> = new Map();

/**
 * Get exchange rate with caching
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  date: Date = new Date()
): Promise<number> {
  if (fromCurrency === toCurrency) {
    return 1.0;
  }

  const cacheKey = `${fromCurrency}_${toCurrency}_${date.toISOString().split('T')[0]}`;
  const cached = RATE_CACHE.get(cacheKey);

  if (cached && cached.expiresAt > new Date()) {
    return cached.rate;
  }

  // Try to get from database first
  const stored = await db.query<{
    rate: number;
  }>(
    `SELECT rate FROM exchange_rates
     WHERE from_currency = $1 AND to_currency = $2 AND rate_date = $3
     ORDER BY created_at DESC LIMIT 1`,
    [fromCurrency, toCurrency, date]
  );

  if (stored.rows.length > 0) {
    const rate = stored.rows[0].rate;
    RATE_CACHE.set(cacheKey, { rate, expiresAt: new Date(Date.now() + 3600000) }); // Cache for 1 hour
    return rate;
  }

  // Fetch from external API (using exchangerate-api.io as example)
  try {
    const response = await axios.get(
      `https://api.exchangerate-api.com/v4/latest/${fromCurrency}`
    );

    const rate = response.data.rates[toCurrency];
    if (!rate) {
      throw new Error(`Exchange rate not found for ${fromCurrency} to ${toCurrency}`);
    }

    // Store in database
    await db.query(
      `INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, source, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'exchangerate-api', NOW())
       ON CONFLICT (from_currency, to_currency, rate_date) DO UPDATE
       SET rate = $3, updated_at = NOW()`,
      [fromCurrency, toCurrency, rate, date]
    );

    RATE_CACHE.set(cacheKey, { rate, expiresAt: new Date(Date.now() + 3600000) });
    return rate;
  } catch (error) {
    logger.error('Failed to fetch exchange rate', error);
    throw new Error(`Failed to get exchange rate: ${fromCurrency} to ${toCurrency}`);
  }
}

/**
 * Convert amount between currencies
 */
export async function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  date: Date = new Date()
): Promise<number> {
  const rate = await getExchangeRate(fromCurrency, toCurrency, date);
  return amount * rate;
}

/**
 * Get account balance in base currency
 */
export async function getAccountBalanceMultiCurrency(
  tenantId: TenantId,
  accountCode: string,
  baseCurrency: string = 'GBP',
  asOfDate?: Date
): Promise<{
  accountCode: string;
  balance: number;
  baseCurrency: string;
  breakdown: Array<{ currency: string; amount: number; convertedAmount: number }>;
}> {
  let query = `
    SELECT 
      currency,
      SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END) as balance
    FROM ledger_entries
    WHERE tenant_id = $1 AND account_code = $2
  `;
  const params: unknown[] = [tenantId, accountCode];

  if (asOfDate) {
    query += ' AND transaction_date <= $3';
    params.push(asOfDate);
  }

  query += ' GROUP BY currency';

  const result = await db.query<{
    currency: string;
    balance: number;
  }>(query, params);

  const breakdown: Array<{ currency: string; amount: number; convertedAmount: number }> = [];
  let totalBalance = 0;

  for (const row of result.rows) {
    const amount = typeof row.balance === 'number' ? row.balance : parseFloat(String(row.balance || '0'));
    const converted = row.currency === baseCurrency
      ? amount
      : await convertCurrency(amount, row.currency, baseCurrency, asOfDate);

    breakdown.push({
      currency: row.currency,
      amount,
      convertedAmount: converted,
    });

    totalBalance += converted;
  }

  return {
    accountCode,
    balance: totalBalance,
    baseCurrency,
    breakdown,
  };
}
