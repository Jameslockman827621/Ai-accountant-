import axios, { AxiosInstance } from 'axios';
import { createLogger } from '@ai-accountant/shared-utils';
import { calculateVATFromLedger } from './vatCalculation';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('filing-service');

const HMRC_SANDBOX_URL = 'https://test-api.service.hmrc.gov.uk';
const HMRC_PRODUCTION_URL = 'https://api.service.hmrc.gov.uk';

export interface HMRCCredentials {
  clientId: string;
  clientSecret: string;
  serverToken: string;
  isSandbox: boolean;
}

export class HMRCClient {
  private client: AxiosInstance;
  private credentials: HMRCCredentials;
  private accessToken?: string;
  private tokenExpiry?: Date;

  constructor(credentials: HMRCCredentials) {
    this.credentials = credentials;
    const baseURL = credentials.isSandbox ? HMRC_SANDBOX_URL : HMRC_PRODUCTION_URL;

    this.client = axios.create({
      baseURL,
      headers: {
        'Accept': 'application/vnd.hmrc.1.0+json',
        'Content-Type': 'application/json',
      },
    });
  }

  async authenticate(): Promise<void> {
    try {
      const response = await axios.post(
        `${this.credentials.isSandbox ? HMRC_SANDBOX_URL : HMRC_PRODUCTION_URL}/oauth/token`,
        {
          grant_type: 'client_credentials',
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      this.accessToken = response.data.access_token;
      const expiresIn = response.data.expires_in || 3600;
      this.tokenExpiry = new Date(Date.now() + expiresIn * 1000);

      logger.info('HMRC authentication successful');
    } catch (error) {
      logger.error('HMRC authentication failed', error instanceof Error ? error : new Error(String(error)));
      throw new Error('Failed to authenticate with HMRC');
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.accessToken || !this.tokenExpiry || this.tokenExpiry <= new Date()) {
      await this.authenticate();
    }
  }

  async submitVATReturn(
    vrn: string,
    periodKey: string,
    vatDueSales: number,
    vatDueAcquisitions: number,
    totalVatDue: number,
    vatReclaimedCurrPeriod: number,
    netVatDue: number,
    totalValueSalesExVAT: number,
    totalValuePurchasesExVAT: number,
    totalValueGoodsSuppliedExVAT: number,
    totalAcquisitionsExVAT: number
  ): Promise<{ submissionId: string; processingDate: string }> {
    await this.ensureAuthenticated();
    
    try {
      // HMRC API expects amounts in pence (multiply by 100)
      const vatReturn = {
        periodKey,
        vatDueSales: Math.round(vatDueSales * 100),
        vatDueAcquisitions: Math.round(vatDueAcquisitions * 100),
        totalVatDue: Math.round(totalVatDue * 100),
        vatReclaimedCurrPeriod: Math.round(vatReclaimedCurrPeriod * 100),
        netVatDue: Math.round(netVatDue * 100),
        totalValueSalesExVAT: Math.round(totalValueSalesExVAT * 100),
        totalValuePurchasesExVAT: Math.round(totalValuePurchasesExVAT * 100),
        totalValueGoodsSuppliedExVAT: Math.round(totalValueGoodsSuppliedExVAT * 100),
        totalAcquisitionsExVAT: Math.round(totalAcquisitionsExVAT * 100),
      };

      const response = await this.client.post(
        `/organisations/vat/${vrn}/returns`,
        vatReturn,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        }
      );

      return {
        submissionId: response.data.formBundleNumber || response.data.receiptId || String(Date.now()),
        processingDate: response.data.processingDate || new Date().toISOString(),
      };
    } catch (error) {
      logger.error('VAT return submission failed', error instanceof Error ? error : new Error(String(error)));
      throw new Error(`Failed to submit VAT return: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getVATObligations(vrn: string): Promise<Array<{ periodKey: string; start: string; end: string; due: string; status: string }>> {
    await this.ensureAuthenticated();

    try {
      const response = await this.client.get(
        `/organisations/vat/${vrn}/obligations`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        }
      );

      return response.data.obligations || [];
    } catch (error) {
      logger.error('Failed to get VAT obligations', error instanceof Error ? error : new Error(String(error)));
      throw new Error(`Failed to get VAT obligations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export async function generateVATFiling(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<Record<string, unknown>> {
  // Calculate VAT from ledger entries
  const calculation = await calculateVATFromLedger(tenantId, periodStart, periodEnd);
  
  return {
    periodKey: calculation.periodKey,
    vatDueSales: calculation.vatDueSales,
    vatDueAcquisitions: calculation.vatDueAcquisitions,
    totalVatDue: calculation.totalVatDue,
    vatReclaimedCurrPeriod: calculation.vatReclaimedCurrPeriod,
    netVatDue: calculation.netVatDue,
    totalValueSalesExVAT: calculation.totalValueSalesExVAT,
    totalValuePurchasesExVAT: calculation.totalValuePurchasesExVAT,
    totalValueGoodsSuppliedExVAT: calculation.totalValueGoodsSuppliedExVAT,
    totalAcquisitionsExVAT: calculation.totalAcquisitionsExVAT,
  };
}
