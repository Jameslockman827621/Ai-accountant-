import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('quickbooks-payroll');

export interface QuickBooksPayrollConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: 'sandbox' | 'production';
}

export interface QuickBooksPayrollRun {
  Id: string;
  PayPeriodStartDate: string;
  PayPeriodEndDate: string;
  CheckDate: string;
  TotalPayroll: number;
  NetPay: number;
  GrossPay: number;
  EmployeeTaxes: number;
  EmployerTaxes: number;
}

export class QuickBooksPayrollService {
  private config: QuickBooksPayrollConfig;
  private baseUrl: string;
  private authUrl: string;

  constructor(config: QuickBooksPayrollConfig) {
    this.config = config;
    this.baseUrl = config.environment === 'production'
      ? 'https://quickbooks.api.intuit.com'
      : 'https://sandbox-quickbooks.api.intuit.com';
    this.authUrl = config.environment === 'production'
      ? 'https://appcenter.intuit.com/connect/oauth2'
      : 'https://appcenter.intuit.com/connect/oauth2';
  }

  /**
   * Generate OAuth authorization URL
   */
  generateAuthorizationUrl(state: string, scopes: string[] = ['com.intuit.quickbooks.payroll']): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
    });

    return `${this.authUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string, realmId: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    try {
      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`
      ).toString('base64');

      const response = await fetch(`${this.authUrl}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.config.redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`QuickBooks API error: ${error.error || 'Unknown error'}`);
      }

      const data = await response.json();
      logger.info('QuickBooks token exchanged', { realmId });

      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    } catch (error) {
      logger.error('Failed to exchange QuickBooks code', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get payroll runs
   */
  async getPayrollRuns(accessToken: string, realmId: string, startDate?: string, endDate?: string): Promise<QuickBooksPayrollRun[]> {
    try {
      let query = 'SELECT * FROM PayrollRun';
      if (startDate || endDate) {
        const conditions: string[] = [];
        if (startDate) conditions.push(`PayPeriodStartDate >= '${startDate}'`);
        if (endDate) conditions.push(`PayPeriodEndDate <= '${endDate}'`);
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      const response = await fetch(
        `${this.baseUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`QuickBooks API error: ${error.error || 'Unknown error'}`);
      }

      const data = await response.json();
      return data.QueryResponse?.PayrollRun || [];
    } catch (error) {
      logger.error('Failed to get QuickBooks payroll runs', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Calculate gross-to-net breakdown
   */
  calculateGrossToNet(payrollRun: QuickBooksPayrollRun): {
    grossPay: number;
    employeeTaxes: number;
    employerTaxes: number;
    netPay: number;
    totalPayroll: number;
  } {
    return {
      grossPay: payrollRun.GrossPay,
      employeeTaxes: payrollRun.EmployeeTaxes,
      employerTaxes: payrollRun.EmployerTaxes,
      netPay: payrollRun.NetPay,
      totalPayroll: payrollRun.TotalPayroll,
    };
  }
}

export function createQuickBooksPayrollService(config: QuickBooksPayrollConfig): QuickBooksPayrollService {
  return new QuickBooksPayrollService(config);
}
