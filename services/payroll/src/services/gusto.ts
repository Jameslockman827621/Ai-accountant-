import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('gusto-payroll');

export interface GustoConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: 'sandbox' | 'production';
}

export interface GustoPayrollRun {
  id: string;
  pay_period_start_date: string;
  pay_period_end_date: string;
  pay_schedule_id: string;
  processed: boolean;
  processed_date?: string;
  payroll_deadline: string;
  check_date: string;
  totals: {
    company_debit: number;
    net_pay: number;
    total_payroll: number;
    employee_compensation: number;
    employer_taxes: number;
    employee_taxes: number;
  };
}

export interface GustoEmployee {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  hire_date: string;
  termination_date?: string;
  active: boolean;
}

export interface GustoPayStub {
  employee_id: string;
  employee_name: string;
  pay_period_start: string;
  pay_period_end: string;
  check_date: string;
  gross_pay: number;
  net_pay: number;
  deductions: Array<{
    name: string;
    amount: number;
    type: string;
  }>;
  taxes: Array<{
    name: string;
    amount: number;
    type: 'federal' | 'state' | 'local';
  }>;
}

export class GustoPayrollService {
  private config: GustoConfig;
  private baseUrl: string;

  constructor(config: GustoConfig) {
    this.config = config;
    this.baseUrl = config.environment === 'production'
      ? 'https://api.gusto.com'
      : 'https://api.gusto-demo.com';
  }

  /**
   * Generate OAuth authorization URL
   */
  generateAuthorizationUrl(state: string, scopes: string[] = ['read:companies', 'read:employees', 'read:payrolls']): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
    });

    return `https://api.gusto.com/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    try {
      const response = await fetch(`${this.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: this.config.redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Gusto API error: ${error.error || 'Unknown error'}`);
      }

      const data = await response.json();
      logger.info('Gusto token exchanged');

      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    } catch (error) {
      logger.error('Failed to exchange Gusto code', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get company payroll runs
   */
  async getPayrollRuns(accessToken: string, companyId: string, startDate?: string, endDate?: string): Promise<GustoPayrollRun[]> {
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);

      const response = await fetch(
        `${this.baseUrl}/v1/companies/${companyId}/payrolls?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Gusto API error: ${error.error || 'Unknown error'}`);
      }

      const data = await response.json();
      return data.payrolls || [];
    } catch (error) {
      logger.error('Failed to get Gusto payroll runs', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get employees for a company
   */
  async getEmployees(accessToken: string, companyId: string): Promise<GustoEmployee[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v1/companies/${companyId}/employees`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Gusto API error: ${error.error || 'Unknown error'}`);
      }

      const data = await response.json();
      return data.employees || [];
    } catch (error) {
      logger.error('Failed to get Gusto employees', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get pay stubs for a payroll run
   */
  async getPayStubs(accessToken: string, payrollId: string): Promise<GustoPayStub[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v1/payrolls/${payrollId}/pay_stubs`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Gusto API error: ${error.error || 'Unknown error'}`);
      }

      const data = await response.json();
      return data.pay_stubs || [];
    } catch (error) {
      logger.error('Failed to get Gusto pay stubs', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Calculate gross-to-net breakdown
   */
  calculateGrossToNet(payStub: GustoPayStub): {
    grossPay: number;
    deductions: number;
    taxes: number;
    netPay: number;
    employerTaxes: number;
  } {
    const deductions = payStub.deductions.reduce((sum, d) => sum + d.amount, 0);
    const taxes = payStub.taxes.reduce((sum, t) => sum + t.amount, 0);

    // Estimate employer taxes (typically 7.65% for FICA in US)
    const estimatedEmployerTaxes = payStub.gross_pay * 0.0765;

    return {
      grossPay: payStub.gross_pay,
      deductions,
      taxes,
      netPay: payStub.net_pay,
      employerTaxes: estimatedEmployerTaxes,
    };
  }

  /**
   * Extract payroll liabilities
   */
  extractPayrollLiabilities(payrollRun: GustoPayrollRun, payStubs: GustoPayStub[]): {
    employeeTaxes: number;
    employerTaxes: number;
    deductions: number;
    netPay: number;
    totalPayroll: number;
  } {
    const employeeTaxes = payStubs.reduce((sum, stub) => {
      return sum + stub.taxes.reduce((taxSum, tax) => taxSum + tax.amount, 0);
    }, 0);

    const employerTaxes = payrollRun.totals.employer_taxes;
    const deductions = payStubs.reduce((sum, stub) => {
      return sum + stub.deductions.reduce((dedSum, ded) => dedSum + ded.amount, 0);
    }, 0);
    const netPay = payrollRun.totals.net_pay;
    const totalPayroll = payrollRun.totals.total_payroll;

    return {
      employeeTaxes,
      employerTaxes,
      deductions,
      netPay,
      totalPayroll,
    };
  }
}

export function createGustoService(config: GustoConfig): GustoPayrollService {
  return new GustoPayrollService(config);
}
