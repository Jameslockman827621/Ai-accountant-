import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { convertCurrency, getExchangeRate } from './fxConversion';

const logger = createLogger('multi-currency-ledger');

export interface MultiCurrencyEntry extends Record<string, unknown> {
  id: string;
  accountId: string;
  amount: number;
  currency: string;
  baseCurrency: string;
  exchangeRate: number;
  baseAmount: number;
  transactionDate: Date;
  description?: string;
}

export interface CurrencyBalance {
  currency: string;
  amount: number;
  baseAmount: number;
  exchangeRate: number;
}

/**
 * Create a ledger entry with multi-currency support
 */
export async function createMultiCurrencyEntry(
  accountId: string,
  amount: number,
  currency: string,
  baseCurrency: string = 'GBP',
  transactionDate: Date = new Date(),
  description?: string
): Promise<MultiCurrencyEntry> {
  const rate = await getExchangeRate(currency, baseCurrency);
  if (!rate) {
    throw new Error(`Unable to get exchange rate for ${currency}/${baseCurrency}`);
  }

  const baseAmount = await convertCurrency(amount, currency, baseCurrency);
  if (baseAmount === null) {
    throw new Error(`Unable to convert ${amount} ${currency} to ${baseCurrency}`);
  }

  const entry: MultiCurrencyEntry = {
    id: `mce_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    accountId,
    amount,
    currency,
    baseCurrency,
    exchangeRate: rate.rate,
    baseAmount,
    transactionDate,
    ...(description ? { description } : {}),
  };

  // Store in database
  await db.query(
    `INSERT INTO multi_currency_entries 
     (id, account_id, amount, currency, base_currency, exchange_rate, base_amount, transaction_date, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.id,
        entry.accountId,
        entry.amount,
        entry.currency,
        entry.baseCurrency,
        entry.exchangeRate,
        entry.baseAmount,
        entry.transactionDate,
        entry.description ?? null,
      ]
  );

  return entry;
}

/**
 * Get account balance in multiple currencies
 */
export async function getMultiCurrencyBalance(
  accountId: string,
  baseCurrency: string = 'GBP'
): Promise<CurrencyBalance[]> {
  const result = await db.query<{
    currency: string;
    amount: number;
  }>(
    `SELECT currency, SUM(amount) as amount
     FROM multi_currency_entries
     WHERE account_id = $1
     GROUP BY currency`,
    [accountId]
  );

  const balances: CurrencyBalance[] = [];

  for (const row of result.rows) {
    const rate = await getExchangeRate(row.currency, baseCurrency);
    if (!rate) {
      logger.warn(`Unable to get exchange rate for ${row.currency}/${baseCurrency}`);
      continue;
    }

    const baseAmount = row.amount * rate.rate;

    balances.push({
      currency: row.currency,
      amount: Math.round(row.amount * 100) / 100,
      baseAmount: Math.round(baseAmount * 100) / 100,
      exchangeRate: rate.rate,
    });
  }

  return balances;
}

/**
 * Revalue account balances using current exchange rates
 */
export async function revalueAccountBalances(
  accountId: string,
  baseCurrency: string = 'GBP'
): Promise<void> {
  const entries = await db.query<MultiCurrencyEntry>(
    `SELECT * FROM multi_currency_entries WHERE account_id = $1`,
    [accountId]
  );

  for (const entry of entries.rows) {
    if (entry.currency === baseCurrency) continue;

    const rate = await getExchangeRate(entry.currency, baseCurrency);
    if (!rate) {
      logger.warn(`Unable to get exchange rate for ${entry.currency}/${baseCurrency}`);
      continue;
    }

    const newBaseAmount = entry.amount * rate.rate;

    await db.query(
      `UPDATE multi_currency_entries
       SET exchange_rate = $1, base_amount = $2
       WHERE id = $3`,
      [rate.rate, newBaseAmount, entry.id]
    );
  }
}

/**
 * Get currency exposure report
 */
export async function getCurrencyExposureReport(
  baseCurrency: string = 'GBP'
): Promise<Record<string, CurrencyBalance>> {
  const result = await db.query<{
    currency: string;
    total_amount: number;
  }>(
    `SELECT currency, SUM(amount) as total_amount
     FROM multi_currency_entries
     GROUP BY currency`
  );

  const exposure: Record<string, CurrencyBalance> = {};

  for (const row of result.rows) {
    if (row.currency === baseCurrency) {
      exposure[row.currency] = {
        currency: row.currency,
        amount: row.total_amount,
        baseAmount: row.total_amount,
        exchangeRate: 1.0,
      };
      continue;
    }

    const rate = await getExchangeRate(row.currency, baseCurrency);
    if (!rate) {
      logger.warn(`Unable to get exchange rate for ${row.currency}/${baseCurrency}`);
      continue;
    }

    exposure[row.currency] = {
      currency: row.currency,
      amount: Math.round(row.total_amount * 100) / 100,
      baseAmount: Math.round(row.total_amount * rate.rate * 100) / 100,
      exchangeRate: rate.rate,
    };
  }

  return exposure;
}
