import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('connector-service');

export type ConnectorType = 'bank' | 'tax_authority' | 'accounting_software' | 'ecommerce' | 'payment_processor';
export type ConnectorProvider = 'plaid' | 'truelayer' | 'hmrc' | 'irs' | 'cra' | 'shopify' | 'stripe' | 'xero' | 'quickbooks';
export type ConnectorStatus = 'required' | 'enabled' | 'disabled' | 'pending' | 'error' | 'expired';

export interface ConnectorConfig {
  tenantId: TenantId;
  connectorType: ConnectorType;
  provider: ConnectorProvider;
  connectorName: string;
  isRequired?: boolean;
  configuration?: Record<string, unknown>;
  scopes?: string[];
}

export interface ConnectorConnection {
  id: string;
  connectorType: ConnectorType;
  provider: ConnectorProvider;
  status: ConnectorStatus;
  connectionId?: string;
  accountIds?: string[];
  tokenExpiresAt?: Date;
  healthStatus?: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
}

export class ConnectorService {
  async registerConnector(config: ConnectorConfig): Promise<string> {
    const connectorId = randomUUID();

    await db.query(
      `INSERT INTO connector_registry (
        id, tenant_id, connector_type, provider, connector_name,
        is_required, is_enabled, status, configuration, scopes,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, NOW(), NOW())`,
      [
        connectorId,
        config.tenantId,
        config.connectorType,
        config.provider,
        config.connectorName,
        config.isRequired || false,
        false,
        config.isRequired ? 'required' : 'pending',
        JSON.stringify(config.configuration || {}),
        config.scopes || [],
      ]
    );

    logger.info('Connector registered', {
      connectorId,
      tenantId: config.tenantId,
      provider: config.provider,
      type: config.connectorType,
    });

    return connectorId;
  }

  async initiateConnection(
    connectorId: string,
    userId: UserId,
    authorizationData?: Record<string, unknown>
  ): Promise<{ authorizationUrl?: string; connectionId?: string }> {
    const connector = await this.getConnector(connectorId);
    if (!connector) {
      throw new Error('Connector not found');
    }

    // Update status to pending
    await db.query(
      `UPDATE connector_registry
       SET status = $1, updated_at = NOW()
       WHERE id = $2`,
      ['pending', connectorId]
    );

    // Generate authorization URL based on provider
    const authResult = await this.generateAuthorizationUrl(
      connector.provider as ConnectorProvider,
      connectorId,
      authorizationData
    );

    logger.info('Connection initiated', {
      connectorId,
      provider: connector.provider,
      userId,
    });

    return authResult;
  }

  async completeConnection(
    connectorId: string,
    userId: UserId,
    connectionData: {
      connectionId: string;
      accountIds?: string[];
      credentials?: Record<string, unknown>;
      tokenExpiresAt?: Date;
    }
  ): Promise<void> {
    // Store credentials securely (in production, use secure store/KMS)
    const credentialStoreKey = `connector_${connectorId}_${Date.now()}`;

    await db.query(
      `UPDATE connector_registry
       SET status = $1,
           is_enabled = $2,
           connection_id = $3,
           account_ids = $4,
           credential_store_key = $5,
           token_expires_at = $6,
           connected_at = NOW(),
           connected_by = $7,
           health_status = $8,
           updated_at = NOW()
       WHERE id = $9`,
      [
        'enabled',
        true,
        connectionData.connectionId,
        connectionData.accountIds || [],
        credentialStoreKey,
        connectionData.tokenExpiresAt || null,
        userId,
        'healthy',
        connectorId,
      ]
    );

    logger.info('Connection completed', {
      connectorId,
      connectionId: connectionData.connectionId,
      userId,
    });
  }

  async getConnector(connectorId: string): Promise<ConnectorConnection | null> {
    const result = await db.query<{
      id: string;
      connector_type: string;
      provider: string;
      status: string;
      connection_id: string | null;
      account_ids: string[] | null;
      token_expires_at: Date | null;
      health_status: string | null;
    }>(
      `SELECT id, connector_type, provider, status, connection_id,
              account_ids, token_expires_at, health_status
       FROM connector_registry
       WHERE id = $1`,
      [connectorId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      connectorType: row.connector_type as ConnectorType,
      provider: row.provider as ConnectorProvider,
      status: row.status as ConnectorStatus,
      connectionId: row.connection_id || undefined,
      accountIds: row.account_ids || undefined,
      tokenExpiresAt: row.token_expires_at || undefined,
      healthStatus: row.health_status as ConnectorConnection['healthStatus'] || undefined,
    };
  }

  async getTenantConnectors(tenantId: TenantId): Promise<ConnectorConnection[]> {
    const result = await db.query<{
      id: string;
      connector_type: string;
      provider: string;
      connector_name: string;
      status: string;
      is_required: boolean;
      is_enabled: boolean;
      connection_id: string | null;
      health_status: string | null;
    }>(
      `SELECT id, connector_type, provider, connector_name, status,
              is_required, is_enabled, connection_id, health_status
       FROM connector_registry
       WHERE tenant_id = $1
       ORDER BY is_required DESC, created_at ASC`,
      [tenantId]
    );

    return result.rows.map(row => ({
      id: row.id,
      connectorType: row.connector_type as ConnectorType,
      provider: row.provider as ConnectorProvider,
      status: row.status as ConnectorStatus,
      connectionId: row.connection_id || undefined,
      healthStatus: row.health_status as ConnectorConnection['healthStatus'] || undefined,
    }));
  }

  async disconnectConnector(connectorId: string, userId: UserId): Promise<void> {
    await db.query(
      `UPDATE connector_registry
       SET status = $1,
           is_enabled = $2,
           connection_id = NULL,
           account_ids = NULL,
           credential_store_key = NULL,
           token_expires_at = NULL,
           disconnected_at = NOW(),
           disconnected_by = $3,
           updated_at = NOW()
       WHERE id = $4`,
      ['disabled', false, userId, connectorId]
    );

    logger.info('Connector disconnected', { connectorId, userId });
  }

  async updateHealthStatus(
    connectorId: string,
    healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown',
    lastSyncAt?: Date
  ): Promise<void> {
    const updates: string[] = ['health_status = $1'];
    const params: unknown[] = [healthStatus];
    let paramCount = 2;

    if (lastSyncAt) {
      updates.push(`last_sync_at = $${paramCount++}`);
      params.push(lastSyncAt);
    }

    params.push(connectorId);

    await db.query(
      `UPDATE connector_registry
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount}`,
      params
    );
  }

  private async generateAuthorizationUrl(
    provider: ConnectorProvider,
    connectorId: string,
    _authorizationData?: Record<string, unknown>
  ): Promise<{ authorizationUrl?: string; connectionId?: string }> {
    // In production, this would generate actual OAuth URLs or API keys
    switch (provider) {
      case 'plaid':
        // Plaid Link flow
        return {
          authorizationUrl: `${process.env.PLAID_AUTH_URL || 'https://plaid.com'}/link?connector=${connectorId}`,
        };

      case 'truelayer':
        // TrueLayer OAuth flow
        return {
          authorizationUrl: `${process.env.TRUELAYER_AUTH_URL || 'https://truelayer.com'}/oauth?connector=${connectorId}`,
        };

      case 'hmrc':
        // HMRC OAuth flow
        return {
          authorizationUrl: `${process.env.HMRC_AUTH_URL || 'https://api.service.hmrc.gov.uk'}/oauth?connector=${connectorId}`,
        };

      case 'shopify':
      case 'stripe':
        // API key-based connections
        return {
          authorizationUrl: undefined,
          connectionId: `mock_${provider}_${connectorId}`,
        };

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  async handleOAuthCallback(
    provider: ConnectorProvider,
    connectorId: string,
    _code: string,
    _state?: string
  ): Promise<{ connectionId: string; accountIds?: string[] }> {
    // In production, exchange code for tokens and create connection
    const connectionId = `conn_${provider}_${randomUUID()}`;
    const accountIds = [`acc_${randomUUID()}`];

    logger.info('OAuth callback processed', {
      provider,
      connectorId,
      connectionId,
    });

    return { connectionId, accountIds };
  }
}

export const connectorService = new ConnectorService();
