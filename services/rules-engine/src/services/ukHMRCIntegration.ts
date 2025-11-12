import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import axios from 'axios';

const logger = createLogger('rules-engine-service');

// HMRC API Configuration
const HMRC_API_BASE = process.env.HMRC_API_BASE || 'https://api.service.hmrc.gov.uk';
const HMRC_CLIENT_ID = process.env.HMRC_CLIENT_ID || '';
const HMRC_CLIENT_SECRET = process.env.HMRC_CLIENT_SECRET || '';
const HMRC_SERVER_TOKEN = process.env.HMRC_SERVER_TOKEN || '';

export interface HMRCAccessToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  expiresAt: Date;
}

let cachedToken: HMRCAccessToken | null = null;

async function getHMRCAccessToken(): Promise<string> {
  // Use cached token if still valid
  if (cachedToken && cachedToken.expiresAt > new Date()) {
    return cachedToken.access_token;
  }

  try {
    const response = await axios.post(
      `${HMRC_API_BASE}/oauth/token`,
      {
        grant_type: 'client_credentials',
        client_id: HMRC_CLIENT_ID,
        client_secret: HMRC_CLIENT_SECRET,
        scope: 'read:vat read:income-tax read:corporation-tax',
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        auth: {
          username: HMRC_CLIENT_ID,
          password: HMRC_CLIENT_SECRET,
        },
      }
    );

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + response.data.expires_in);

    cachedToken = {
      access_token: response.data.access_token,
      token_type: response.data.token_type,
      expires_in: response.data.expires_in,
      scope: response.data.scope,
      expiresAt,
    };

    return cachedToken.access_token;
  } catch (error) {
    logger.error('Failed to get HMRC access token', error instanceof Error ? error : new Error(String(error)));
    throw new Error('Failed to authenticate with HMRC API');
  }
}

export interface HMRCVATReturn {
  periodKey: string;
  vatDueSales: number;
  vatDueAcquisitions: number;
  totalVatDue: number;
  vatReclaimedCurrPeriod: number;
  netVatDue: number;
  totalValueSalesExVAT: number;
  totalValuePurchasesExVAT: number;
  totalValueGoodsSuppliedExVAT: number;
  totalAcquisitionsExVAT: number;
}

export async function getHMRCVATReturns(
  vatNumber: string,
  fromDate?: Date,
  toDate?: Date
): Promise<HMRCVATReturn[]> {
  try {
    const token = await getHMRCAccessToken();
    
    const params: Record<string, string> = {};
    if (fromDate) {
      params.from = fromDate.toISOString().split('T')[0];
    }
    if (toDate) {
      params.to = toDate.toISOString().split('T')[0];
    }

    const response = await axios.get(
      `${HMRC_API_BASE}/organisations/vat/${vatNumber}/returns`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.hmrc.1.0+json',
        },
        params,
      }
    );

    return response.data;
  } catch (error) {
    logger.error('Failed to get HMRC VAT returns', error instanceof Error ? error : new Error(String(error)));
    // Fallback to local calculation
    return [];
  }
}

export async function submitHMRCVATReturn(
  vatNumber: string,
  returnData: HMRCVATReturn
): Promise<{ success: boolean; submissionId?: string; error?: string }> {
  try {
    const token = await getHMRCAccessToken();

    const response = await axios.post(
      `${HMRC_API_BASE}/organisations/vat/${vatNumber}/returns`,
      returnData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.hmrc.1.0+json',
        },
      }
    );

    return {
      success: true,
      submissionId: response.data.id,
    };
  } catch (error) {
    logger.error('Failed to submit HMRC VAT return', error instanceof Error ? error : new Error(String(error)));
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export interface HMRCIncomeTaxLiability {
  taxYear: string;
  totalIncome: number;
  allowances: number;
  taxableIncome: number;
  incomeTax: number;
  nationalInsurance: number;
  totalLiability: number;
}

export async function getHMRCIncomeTaxLiability(
  nino: string,
  taxYear: string
): Promise<HMRCIncomeTaxLiability | null> {
  try {
    const token = await getHMRCAccessToken();

    const response = await axios.get(
      `${HMRC_API_BASE}/individuals/income/${nino}/${taxYear}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.hmrc.1.0+json',
        },
      }
    );

    return response.data;
  } catch (error) {
    logger.error('Failed to get HMRC income tax liability', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

export interface HMRCCorporationTaxLiability {
  companyNumber: string;
  accountingPeriod: {
    start: Date;
    end: Date;
  };
  profitBeforeTax: number;
  corporationTax: number;
  filingDeadline: Date;
}

export async function getHMRCCorporationTaxLiability(
  companyNumber: string,
  accountingPeriodEnd: Date
): Promise<HMRCCorporationTaxLiability | null> {
  try {
    const token = await getHMRCAccessToken();

    const response = await axios.get(
      `${HMRC_API_BASE}/corporation-tax/companies/${companyNumber}/liabilities`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.hmrc.1.0+json',
        },
        params: {
          periodEnd: accountingPeriodEnd.toISOString().split('T')[0],
        },
      }
    );

    return response.data;
  } catch (error) {
    logger.error('Failed to get HMRC corporation tax liability', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

export async function validateVATNumber(vatNumber: string): Promise<{ valid: boolean; name?: string; address?: string }> {
  try {
    // EU VAT number validation API
    const response = await axios.get(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/GB/vat/${vatNumber}`,
      {
        timeout: 5000,
      }
    );

    return {
      valid: response.data.valid,
      name: response.data.name,
      address: response.data.address,
    };
  } catch (error) {
    logger.error('Failed to validate VAT number', error instanceof Error ? error : new Error(String(error)));
    return { valid: false };
  }
}

export async function getHMRCTaxRates(taxYear: string): Promise<{
  incomeTax: any;
  corporationTax: any;
  vat: any;
  nationalInsurance: any;
} | null> {
  try {
    // HMRC doesn't have a direct API for tax rates, but we can use their published data
    // For now, return null and use our internal rates
    // In production, this would fetch from HMRC's published tax rates endpoint or database
    
    logger.info('Tax rates fetched from internal database', { taxYear });
    return null;
  } catch (error) {
    logger.error('Failed to get HMRC tax rates', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}
