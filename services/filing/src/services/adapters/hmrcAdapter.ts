import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';

const logger = createLogger('hmrc-adapter');

export interface HMRCObligation {
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: string;
}

export interface HMRCVATReturn {
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

export class HMRCAdapter {
  private sandboxMode: boolean;

  constructor(sandboxMode: boolean = false) {
    this.sandboxMode = sandboxMode;
  }

  /**
   * Get VAT obligations
   */
  async getObligations(tenantId: TenantId): Promise<HMRCObligation[]> {
    // Get HMRC credentials
    const credentials = await this.getCredentials(tenantId);
    if (!credentials) {
      throw new Error('HMRC credentials not found');
    }

    if (this.sandboxMode) {
      // Return mock obligations
      return [
        {
          periodKey: '24A1',
          periodStart: '2024-01-01',
          periodEnd: '2024-03-31',
          dueDate: '2024-05-07',
          status: 'O',
        },
      ];
    }

    // In production, call HMRC API
    // const response = await fetch('https://api.service.hmrc.gov.uk/vat/obligations', {
    //   headers: {
    //     'Authorization': `Bearer ${credentials.accessToken}`,
    //   },
    // });
    // return response.json();

    logger.info('Getting HMRC obligations', { tenantId, sandboxMode: this.sandboxMode });
    return [];
  }

  /**
   * Submit VAT return
   */
  async submitVATReturn(
    tenantId: TenantId,
    periodKey: string,
    vatReturn: HMRCVATReturn
  ): Promise<string> {
    const credentials = await this.getCredentials(tenantId);
    if (!credentials) {
      throw new Error('HMRC credentials not found');
    }

    if (this.sandboxMode) {
      // Return mock submission reference
      return `HMRC-SANDBOX-${Date.now()}`;
    }

    // In production, call HMRC API
    // const response = await fetch(`https://api.service.hmrc.gov.uk/vat/returns/${periodKey}`, {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${credentials.accessToken}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify(vatReturn),
    // });
    // const result = await response.json();
    // return result.processingDate;

    logger.info('Submitting HMRC VAT return', { tenantId, periodKey, sandboxMode: this.sandboxMode });
    return `HMRC-${Date.now()}`;
  }

  /**
   * Get submission status
   */
  async getSubmissionStatus(tenantId: TenantId, submissionReference: string): Promise<{
    status: string;
    processingDate?: string;
    paymentIndicator?: string;
  }> {
    if (this.sandboxMode) {
      return {
        status: 'processed',
        processingDate: new Date().toISOString(),
        paymentIndicator: 'DD',
      };
    }

    // In production, call HMRC API
    logger.info('Getting HMRC submission status', { tenantId, submissionReference });
    return { status: 'unknown' };
  }

  private async getCredentials(tenantId: TenantId): Promise<{
    accessToken: string;
    refreshToken: string;
  } | null> {
    const result = await db.query<{
      credential_store_key: string;
      connection_id: string;
    }>(
      `SELECT credential_store_key, connection_id
       FROM connector_registry
       WHERE tenant_id = $1
         AND provider = 'hmrc'
         AND is_enabled = true
       LIMIT 1`,
      [tenantId]
    );

    if (result.rows.length === 0) return null;

    // In production, decrypt credentials from secure store
    return {
      accessToken: 'mock_token',
      refreshToken: 'mock_refresh',
    };
  }
}

export const hmrcAdapter = new HMRCAdapter(process.env.HMRC_SANDBOX === 'true');
