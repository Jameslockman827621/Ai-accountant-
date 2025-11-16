import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('hmrc-oauth');

export interface HMRCConfig {
  clientId: string;
  clientSecret: string;
  serverToken: string;
  redirectUri: string;
  environment: 'sandbox' | 'production';
}

export interface HMRCAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
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

export class HMRCOAuthService {
  private config: HMRCConfig;
  private baseUrl: string;
  private authUrl: string;

  constructor(config: HMRCConfig) {
    this.config = config;
    this.baseUrl = config.environment === 'production'
      ? 'https://api.service.hmrc.gov.uk'
      : 'https://test-api.service.hmrc.gov.uk';
    this.authUrl = config.environment === 'production'
      ? 'https://www.tax.service.gov.uk'
      : 'https://test-api.service.hmrc.gov.uk';
  }

  /**
   * Generate authorization URL for OAuth flow
   */
  generateAuthorizationUrl(state: string, scopes: string[] = ['read:vat', 'write:vat']): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: scopes.join(' '),
      state,
    });

    return `${this.authUrl}/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<HMRCAuthResponse> {
    try {
      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`
      ).toString('base64');

      const response = await fetch(`${this.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
          Accept: 'application/vnd.hmrc.1.0+json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.config.redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`HMRC API error: ${error.error || 'Unknown error'}`);
      }

      const data = await response.json();
      logger.info('HMRC token exchanged', { scope: data.scope });

      return data;
    } catch (error) {
      logger.error('Failed to exchange HMRC code', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<HMRCAuthResponse> {
    try {
      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`
      ).toString('base64');

      const response = await fetch(`${this.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
          Accept: 'application/vnd.hmrc.1.0+json',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`HMRC API error: ${error.error || 'Unknown error'}`);
      }

      const data = await response.json();
      logger.info('HMRC token refreshed');

      return data;
    } catch (error) {
      logger.error('Failed to refresh HMRC token', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get VAT obligations
   */
  async getVATObligations(accessToken: string, vrn: string): Promise<any[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/organisations/vat/${vrn}/obligations`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.hmrc.1.0+json',
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`HMRC API error: ${error.message || 'Unknown error'}`);
      }

      const data = await response.json();
      return data.obligations || [];
    } catch (error) {
      logger.error('Failed to get HMRC VAT obligations', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get VAT return for a period
   */
  async getVATReturn(accessToken: string, vrn: string, periodKey: string): Promise<HMRCVATReturn> {
    try {
      const response = await fetch(
        `${this.baseUrl}/organisations/vat/${vrn}/returns/${periodKey}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.hmrc.1.0+json',
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`HMRC API error: ${error.message || 'Unknown error'}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      logger.error('Failed to get HMRC VAT return', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Submit VAT return
   */
  async submitVATReturn(
    accessToken: string,
    vrn: string,
    returnData: HMRCVATReturn
  ): Promise<{ processingDate: string; paymentIndicator?: string; formBundleNumber: string }> {
    try {
      const response = await fetch(
        `${this.baseUrl}/organisations/vat/${vrn}/returns`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.hmrc.1.0+json',
          },
          body: JSON.stringify(returnData),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`HMRC API error: ${error.message || 'Unknown error'}`);
      }

      const data = await response.json();
      logger.info('HMRC VAT return submitted', { vrn, formBundleNumber: data.formBundleNumber });

      return data;
    } catch (error) {
      logger.error('Failed to submit HMRC VAT return', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }
}

export function createHMRCService(config: HMRCConfig): HMRCOAuthService {
  return new HMRCOAuthService(config);
}
