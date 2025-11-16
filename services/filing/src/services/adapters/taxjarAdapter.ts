import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';

const logger = createLogger('taxjar-adapter');

export interface TaxJarSalesTaxReturn {
  period: string;
  state: string;
  salesAmount: number;
  taxableAmount: number;
  taxAmount: number;
  exemptAmount: number;
}

export class TaxJarAdapter {
  private apiKey: string | null = null;
  private sandboxMode: boolean;

  constructor(sandboxMode: boolean = false) {
    this.sandboxMode = sandboxMode;
  }

  /**
   * Calculate sales tax for period
   */
  async calculateSalesTax(
    tenantId: TenantId,
    periodStart: string,
    periodEnd: string,
    state: string
  ): Promise<TaxJarSalesTaxReturn> {
    await this.ensureApiKey(tenantId);

    if (this.sandboxMode) {
      // Return mock calculation
      return {
        period: `${periodStart}_${periodEnd}`,
        state,
        salesAmount: 10000,
        taxableAmount: 9000,
        taxAmount: 720, // 8% rate
        exemptAmount: 1000,
      };
    }

    // In production, call TaxJar API
    // const response = await fetch(`https://api.taxjar.com/v2/taxes`, {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${this.apiKey}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     from_country: 'US',
    //     from_state: state,
    //     to_country: 'US',
    //     to_state: state,
    //     amount: salesAmount,
    //     shipping: 0,
    //   }),
    // });
    // return response.json();

    logger.info('Calculating TaxJar sales tax', { tenantId, periodStart, periodEnd, state });
    return {
      period: `${periodStart}_${periodEnd}`,
      state,
      salesAmount: 0,
      taxableAmount: 0,
      taxAmount: 0,
      exemptAmount: 0,
    };
  }

  /**
   * Submit sales tax return
   */
  async submitSalesTaxReturn(
    tenantId: TenantId,
    returnData: TaxJarSalesTaxReturn
  ): Promise<string> {
    await this.ensureApiKey(tenantId);

    if (this.sandboxMode) {
      return `TAXJAR-SANDBOX-${Date.now()}`;
    }

    // In production, call TaxJar API
    logger.info('Submitting TaxJar sales tax return', { tenantId, returnData });
    return `TAXJAR-${Date.now()}`;
  }

  private async ensureApiKey(tenantId: TenantId): Promise<void> {
    if (this.apiKey) return;

    const result = await db.query<{ credential_store_key: string }>(
      `SELECT credential_store_key
       FROM connector_registry
       WHERE tenant_id = $1
         AND provider = 'taxjar'
         AND is_enabled = true
       LIMIT 1`,
      [tenantId]
    );

    if (result.rows.length === 0) {
      throw new Error('TaxJar API key not found');
    }

    // In production, decrypt from secure store
    this.apiKey = 'mock_taxjar_key';
  }
}

export const taxjarAdapter = new TaxJarAdapter(process.env.TAXJAR_SANDBOX === 'true');
