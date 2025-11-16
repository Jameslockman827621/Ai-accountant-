import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';

const logger = createLogger('cra-adapter');

export interface CRAGSTReturn {
  period: string;
  province: string;
  salesAmount: number;
  gstAmount: number;
  hstAmount: number;
  qstAmount: number;
  inputTaxCredits: number;
  netTaxOwing: number;
}

export class CRAAdapter {
  private sandboxMode: boolean;

  constructor(sandboxMode: boolean = false) {
    this.sandboxMode = sandboxMode;
  }

  /**
   * Submit GST/HST return
   */
  async submitGSTReturn(
    tenantId: TenantId,
    returnData: CRAGSTReturn
  ): Promise<string> {
    const credentials = await this.getCredentials(tenantId);
    if (!credentials) {
      throw new Error('CRA credentials not found');
    }

    if (this.sandboxMode) {
      return `CRA-SANDBOX-${Date.now()}`;
    }

    // In production, call CRA API
    logger.info('Submitting CRA GST return', { tenantId, returnData });
    return `CRA-${Date.now()}`;
  }

  /**
   * Submit QST return (Quebec)
   */
  async submitQSTReturn(
    tenantId: TenantId,
    returnData: CRAGSTReturn
  ): Promise<string> {
    const credentials = await this.getCredentials(tenantId);
    if (!credentials) {
      throw new Error('Revenu Québec credentials not found');
    }

    if (this.sandboxMode) {
      return `RQ-SANDBOX-${Date.now()}`;
    }

    logger.info('Submitting Revenu Québec QST return', { tenantId, returnData });
    return `RQ-${Date.now()}`;
  }

  private async getCredentials(tenantId: TenantId): Promise<{
    accessToken: string;
    businessNumber: string;
  } | null> {
    const result = await db.query<{
      credential_store_key: string;
      connection_id: string;
    }>(
      `SELECT credential_store_key, connection_id
       FROM connector_registry
       WHERE tenant_id = $1
         AND provider IN ('cra', 'revenu_quebec')
         AND is_enabled = true
       LIMIT 1`,
      [tenantId]
    );

    if (result.rows.length === 0) return null;

    // In production, decrypt credentials
    return {
      accessToken: 'mock_token',
      businessNumber: '123456789',
    };
  }
}

export const craAdapter = new CRAAdapter(process.env.CRA_SANDBOX === 'true');
