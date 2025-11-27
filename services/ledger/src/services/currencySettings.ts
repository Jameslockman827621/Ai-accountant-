import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { exchangeRateService } from './exchangeRateService';

const logger = createLogger('currency-settings');

export type ValuationMethod = 'spot' | 'average' | 'month_end';

export interface CurrencySettings {
  baseCurrency: string;
  fxProvider: string;
  valuationMethod: ValuationMethod;
  exposureCurrencies: string[];
}

async function ensureTable(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS tenant_currency_settings (
      tenant_id uuid PRIMARY KEY,
      base_currency varchar(3) NOT NULL DEFAULT 'GBP',
      fx_provider text NOT NULL DEFAULT 'ECB',
      valuation_method text NOT NULL DEFAULT 'spot',
      exposure_currencies text[] DEFAULT ARRAY['USD','EUR'],
      updated_at timestamptz DEFAULT NOW()
    )
  `);
}

export async function getCurrencySettings(tenantId: TenantId): Promise<CurrencySettings> {
  await ensureTable();
  const result = await db.query<{
    base_currency: string;
    fx_provider: string;
    valuation_method: ValuationMethod;
    exposure_currencies: string[];
  }>(
    `SELECT base_currency, fx_provider, valuation_method, exposure_currencies
     FROM tenant_currency_settings WHERE tenant_id = $1`,
    [tenantId]
  );

  if (result.rows.length === 0) {
    return {
      baseCurrency: 'GBP',
      fxProvider: 'ECB',
      valuationMethod: 'spot',
      exposureCurrencies: ['USD', 'EUR'],
    };
  }

  const row = result.rows[0];
  return {
    baseCurrency: row.base_currency,
    fxProvider: row.fx_provider,
    valuationMethod: row.valuation_method,
    exposureCurrencies: row.exposure_currencies,
  };
}

export async function updateCurrencySettings(
  tenantId: TenantId,
  settings: Partial<CurrencySettings>
): Promise<CurrencySettings> {
  await ensureTable();
  const current = await getCurrencySettings(tenantId);
  const nextSettings: CurrencySettings = {
    baseCurrency: settings.baseCurrency || current.baseCurrency,
    fxProvider: settings.fxProvider || current.fxProvider,
    valuationMethod: settings.valuationMethod || current.valuationMethod,
    exposureCurrencies: settings.exposureCurrencies || current.exposureCurrencies,
  };

  await db.query(
    `INSERT INTO tenant_currency_settings (tenant_id, base_currency, fx_provider, valuation_method, exposure_currencies)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id) DO UPDATE
     SET base_currency = $2,
         fx_provider = $3,
         valuation_method = $4,
         exposure_currencies = $5,
         updated_at = NOW()` ,
    [
      tenantId,
      nextSettings.baseCurrency,
      nextSettings.fxProvider,
      nextSettings.valuationMethod,
      nextSettings.exposureCurrencies,
    ]
  );

  logger.info('Currency settings updated', { tenantId, settings: nextSettings });
  return nextSettings;
}

export async function valuateExposure(
  tenantId: TenantId,
  asOfDate: Date,
  currencies: string[],
  baseCurrency?: string,
  provider?: string
): Promise<Record<string, number>> {
  const settings = await getCurrencySettings(tenantId);
  const fxProvider = provider || settings.fxProvider;
  const targetBase = baseCurrency || settings.baseCurrency;
  const exposures: Record<string, number> = {};

  for (const currency of currencies) {
    const rate = await exchangeRateService.getExchangeRate(
      tenantId,
      currency,
      targetBase,
      asOfDate,
      { provider: fxProvider }
    );
    exposures[currency] = rate;
  }

  return exposures;
}

export function listFxProviders(): string[] {
  return ['ECB', 'OANDA', 'manual'];
}
