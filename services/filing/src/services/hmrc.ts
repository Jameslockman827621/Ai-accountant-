import axios, { AxiosInstance } from 'axios';
import { createLogger } from '@ai-accountant/shared-utils';

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
      const response = await this.client.post(
        `/organisations/vat/${vrn}/returns`,
        {
          periodKey,
          vatDueSales,
          vatDueAcquisitions,
          totalVatDue,
          vatReclaimedCurrPeriod,
          netVatDue,
          totalValueSalesExVAT,
          totalValuePurchasesExVAT,
          totalValueGoodsSuppliedExVAT,
          totalAcquisitionsExVAT,
        },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        }
      );

      return {
        submissionId: response.data.formBundleNumber,
        processingDate: response.data.processingDate,
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
  _tenantId: string,
  periodStart: Date,
  _periodEnd: Date
): Promise<Record<string, unknown>> {
  // This would calculate VAT from ledger entries
  // For now, return a template structure
  const periodKey = `${periodStart.getFullYear()}${String(periodStart.getMonth() + 1).padStart(2, '0')}`;
  return {
    periodKey,
    vatDueSales: 0,
    vatDueAcquisitions: 0,
    totalVatDue: 0,
    vatReclaimedCurrPeriod: 0,
    netVatDue: 0,
    totalValueSalesExVAT: 0,
    totalValuePurchasesExVAT: 0,
    totalValueGoodsSuppliedExVAT: 0,
    totalAcquisitionsExVAT: 0,
  };
}
