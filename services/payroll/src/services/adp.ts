import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('adp-payroll');

export interface ADPConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string; // ADP-specific base URL
  environment: 'sandbox' | 'production';
}

export interface ADPPayrollRun {
  payPeriodStartDate: string;
  payPeriodEndDate: string;
  checkDate: string;
  totalGrossPay: number;
  totalNetPay: number;
  totalEmployeeTaxes: number;
  totalEmployerTaxes: number;
  employeeCount: number;
}

export class ADPPayrollService {
  private config: ADPConfig;
  private accessToken?: string;
  private tokenExpiresAt?: Date;

  constructor(config: ADPConfig) {
    this.config = config;
  }

  /**
   * Authenticate and get access token
   */
  async authenticate(): Promise<string> {
    if (this.accessToken && this.tokenExpiresAt && this.tokenExpiresAt > new Date()) {
      return this.accessToken;
    }

    try {
      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`
      ).toString('base64');

      const response = await fetch(`${this.config.baseUrl}/auth/oauth/v2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`ADP API error: ${error.error || 'Unknown error'}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      const expiresIn = data.expires_in || 3600;
      this.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

      logger.info('ADP authenticated');
      return this.accessToken;
    } catch (error) {
      logger.error('Failed to authenticate with ADP', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get payroll runs (read-only access)
   */
  async getPayrollRuns(workerId: string, startDate?: string, endDate?: string): Promise<ADPPayrollRun[]> {
    try {
      const token = await this.authenticate();

      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await fetch(
        `${this.config.baseUrl}/hr/v2/workers/${workerId}/pay-statements?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`ADP API error: ${error.error || 'Unknown error'}`);
      }

      const data = await response.json();
      // Transform ADP response to our format
      return (data.payStatements || []).map((ps: any) => ({
        payPeriodStartDate: ps.payPeriodStartDate,
        payPeriodEndDate: ps.payPeriodEndDate,
        checkDate: ps.checkDate,
        totalGrossPay: ps.totalGrossPay?.amountValue || 0,
        totalNetPay: ps.totalNetPay?.amountValue || 0,
        totalEmployeeTaxes: ps.totalEmployeeTaxes?.amountValue || 0,
        totalEmployerTaxes: ps.totalEmployerTaxes?.amountValue || 0,
        employeeCount: ps.employeeCount || 1,
      }));
    } catch (error) {
      logger.error('Failed to get ADP payroll runs', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }
}

export function createADPService(config: ADPConfig): ADPPayrollService {
  return new ADPPayrollService(config);
}
