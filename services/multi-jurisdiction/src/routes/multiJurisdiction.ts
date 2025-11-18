import { Router } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import {
  calculateUSTotalTax,
  getUSStateTaxInfo,
  calculateUSSalesTax,
} from '../services/usTaxSystem';
import {
  getEUTaxInfo,
  calculateEUVAT,
  calculateEUIncomeTax,
  calculateEUCorporateTax,
  getAllEUCountries,
} from '../services/euTaxSystem';
import {
  getExchangeRate,
  convertCurrency,
  getSupportedCurrencies,
} from '../services/fxConversion';
import {
  createMultiCurrencyEntry,
  getMultiCurrencyBalance,
  revalueAccountBalances,
  getCurrencyExposureReport,
} from '../services/multiCurrencyLedger';

const logger = createLogger('multi-jurisdiction-routes');
const router = Router();

// US Tax Routes
router.post('/us/tax/calculate', async (req, res) => {
  try {
    const { income, stateCode, filingStatus, localIncomeTaxRate } = req.body;

    if (!income || !stateCode) {
      return res.status(400).json({ error: 'Income and stateCode are required' });
    }

    const result = calculateUSTotalTax(
      income,
      stateCode,
      filingStatus || 'single',
      localIncomeTaxRate || 0
    );

    return res.json({ tax: result });
  } catch (error) {
    logger.error('Failed to calculate US tax', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to calculate US tax' });
  }
});

router.get('/us/tax/state/:stateCode', async (req, res) => {
  try {
    const { stateCode } = req.params;
    const info = getUSStateTaxInfo(stateCode);

    if (!info) {
      return res.status(404).json({ error: 'State not found' });
    }

    return res.json({ stateTax: info });
  } catch (error) {
    logger.error('Failed to get US state tax info', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to get US state tax info' });
  }
});

router.post('/us/tax/sales', async (req, res) => {
  try {
    const { amount, stateCode, localRate } = req.body;

    if (!amount || !stateCode) {
      return res.status(400).json({ error: 'Amount and stateCode are required' });
    }

    const tax = calculateUSSalesTax(amount, stateCode, localRate || 0);
    return res.json({ salesTax: tax });
  } catch (error) {
    logger.error('Failed to calculate US sales tax', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to calculate US sales tax' });
  }
});

// EU Tax Routes
router.get('/eu/countries', async (_req, res) => {
  try {
    const countries = getAllEUCountries();
    return res.json({ countries });
  } catch (error) {
    logger.error('Failed to get EU countries', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to get EU countries' });
  }
});

router.get('/eu/tax/:countryCode', async (req, res) => {
  try {
    const { countryCode } = req.params;
    const info = getEUTaxInfo(countryCode);

    if (!info) {
      return res.status(404).json({ error: 'Country not found' });
    }

    return res.json({ taxInfo: info });
  } catch (error) {
    logger.error('Failed to get EU tax info', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to get EU tax info' });
  }
});

router.post('/eu/tax/vat', async (req, res) => {
  try {
    const { amount, countryCode, isReduced } = req.body;

    if (!amount || !countryCode) {
      return res.status(400).json({ error: 'Amount and countryCode are required' });
    }

    const vat = calculateEUVAT(amount, countryCode, isReduced || false);
    return res.json({ vat });
  } catch (error) {
    logger.error('Failed to calculate EU VAT', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to calculate EU VAT' });
  }
});

router.post('/eu/tax/income', async (req, res) => {
  try {
    const { income, countryCode } = req.body;

    if (!income || !countryCode) {
      return res.status(400).json({ error: 'Income and countryCode are required' });
    }

    const tax = calculateEUIncomeTax(income, countryCode);
    return res.json({ incomeTax: tax });
  } catch (error) {
    logger.error('Failed to calculate EU income tax', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to calculate EU income tax' });
  }
});

router.post('/eu/tax/corporate', async (req, res) => {
  try {
    const { profit, countryCode } = req.body;

    if (!profit || !countryCode) {
      return res.status(400).json({ error: 'Profit and countryCode are required' });
    }

    const tax = calculateEUCorporateTax(profit, countryCode);
    return res.json({ corporateTax: tax });
  } catch (error) {
    logger.error('Failed to calculate EU corporate tax', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to calculate EU corporate tax' });
  }
});

// FX Conversion Routes
router.get('/fx/rate/:from/:to', async (req, res) => {
  try {
    const { from, to } = req.params;
    const useAPI = req.query.useAPI === 'true';

    const rate = await getExchangeRate(from.toUpperCase(), to.toUpperCase(), useAPI);

    if (!rate) {
      return res.status(404).json({ error: 'Exchange rate not found' });
    }

    return res.json({ rate });
  } catch (error) {
    logger.error('Failed to get exchange rate', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to get exchange rate' });
  }
});

router.post('/fx/convert', async (req, res) => {
  try {
    const { amount, from, to, useAPI } = req.body;

    if (!amount || !from || !to) {
      return res.status(400).json({ error: 'Amount, from, and to are required' });
    }

    const converted = await convertCurrency(amount, from.toUpperCase(), to.toUpperCase(), useAPI || false);

    if (converted === null) {
      return res.status(400).json({ error: 'Currency conversion failed' });
    }

    return res.json({ amount: converted, from, to });
  } catch (error) {
    logger.error('Failed to convert currency', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to convert currency' });
  }
});

router.get('/fx/currencies', async (_req, res) => {
  try {
    const currencies = getSupportedCurrencies();
    return res.json({ currencies });
  } catch (error) {
    logger.error('Failed to get supported currencies', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to get supported currencies' });
  }
});

// Multi-Currency Ledger Routes
router.post('/ledger/entry', async (req, res) => {
  try {
    const { accountId, amount, currency, baseCurrency, transactionDate, description } = req.body;

    if (!accountId || !amount || !currency) {
      return res.status(400).json({ error: 'accountId, amount, and currency are required' });
    }

    const entry = await createMultiCurrencyEntry(
      accountId,
      amount,
      currency,
      baseCurrency || 'GBP',
      transactionDate ? new Date(transactionDate) : new Date(),
      description
    );

    return res.json({ entry });
  } catch (error) {
    logger.error('Failed to create multi-currency entry', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to create multi-currency entry' });
  }
});

router.get('/ledger/balance/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { baseCurrency } = req.query;

    const balances = await getMultiCurrencyBalance(accountId, (baseCurrency as string) || 'GBP');
    return res.json({ balances });
  } catch (error) {
    logger.error('Failed to get multi-currency balance', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to get multi-currency balance' });
  }
});

router.post('/ledger/revalue/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { baseCurrency } = req.body;

    await revalueAccountBalances(accountId, baseCurrency || 'GBP');
    return res.json({ success: true });
  } catch (error) {
    logger.error('Failed to revalue account balances', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to revalue account balances' });
  }
});

router.get('/ledger/exposure', async (req, res) => {
  try {
    const { baseCurrency } = req.query;

    const exposure = await getCurrencyExposureReport((baseCurrency as string) || 'GBP');
    return res.json({ exposure });
  } catch (error) {
    logger.error('Failed to get currency exposure', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Failed to get currency exposure' });
  }
});

export default router;
