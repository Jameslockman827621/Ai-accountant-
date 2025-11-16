import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('connector-catalog-service');

export interface ConnectorCatalogEntry {
  id: string;
  provider: string;
  providerName: string;
  connectorType: 'bank' | 'accounting' | 'payroll' | 'commerce';
  supportedJurisdictions: string[];
  supportedEntityTypes: string[];
  authType: 'oauth2' | 'api_key' | 'token' | 'link_token';
  authConfig: Record<string, unknown>;
  requiredScopes: string[];
  optionalScopes: string[];
  capabilities: string[];
  syncFrequencyOptions: string[];
  defaultSyncFrequency: string;
  description?: string;
  documentationUrl?: string;
  logoUrl?: string;
  category: 'primary' | 'secondary' | 'optional';
  priority: number;
  enabled: boolean;
  isBeta: boolean;
  maintenanceMode: boolean;
}

/**
 * Get connector catalog entries
 */
export async function getConnectorCatalog(
  jurisdictionCode?: string,
  entityType?: string,
  connectorType?: string
): Promise<ConnectorCatalogEntry[]> {
  try {
    let query = `
      SELECT id, provider, provider_name, connector_type, supported_jurisdictions,
             supported_entity_types, auth_type, auth_config, required_scopes,
             optional_scopes, capabilities, sync_frequency_options,
             default_sync_frequency, description, documentation_url, logo_url,
             category, priority, enabled, is_beta, maintenance_mode
      FROM connector_catalog
      WHERE enabled = true AND maintenance_mode = false
    `;
    const params: unknown[] = [];
    let paramCount = 1;

    if (jurisdictionCode) {
      query += ` AND ($${paramCount} = ANY(supported_jurisdictions) OR array_length(supported_jurisdictions, 1) IS NULL)`;
      params.push(jurisdictionCode);
      paramCount++;
    }

    if (entityType) {
      query += ` AND ($${paramCount} = ANY(supported_entity_types) OR array_length(supported_entity_types, 1) IS NULL)`;
      params.push(entityType);
      paramCount++;
    }

    if (connectorType) {
      query += ` AND connector_type = $${paramCount}`;
      params.push(connectorType);
      paramCount++;
    }

    query += ` ORDER BY priority DESC, provider_name ASC`;

    const result = await db.query<{
      id: string;
      provider: string;
      provider_name: string;
      connector_type: string;
      supported_jurisdictions: string[];
      supported_entity_types: string[];
      auth_type: string;
      auth_config: unknown;
      required_scopes: string[];
      optional_scopes: string[];
      capabilities: unknown;
      sync_frequency_options: string[];
      default_sync_frequency: string;
      description: string | null;
      documentation_url: string | null;
      logo_url: string | null;
      category: string;
      priority: number;
      enabled: boolean;
      is_beta: boolean;
      maintenance_mode: boolean;
    }>(query, params);

    return result.rows.map(row => ({
      id: row.id,
      provider: row.provider,
      providerName: row.provider_name,
      connectorType: row.connector_type as ConnectorCatalogEntry['connectorType'],
      supportedJurisdictions: row.supported_jurisdictions || [],
      supportedEntityTypes: row.supported_entity_types || [],
      authType: row.auth_type as ConnectorCatalogEntry['authType'],
      authConfig: (row.auth_config as Record<string, unknown>) || {},
      requiredScopes: row.required_scopes || [],
      optionalScopes: row.optional_scopes || [],
      capabilities: (row.capabilities as string[]) || [],
      syncFrequencyOptions: row.sync_frequency_options || [],
      defaultSyncFrequency: row.default_sync_frequency,
      description: row.description || undefined,
      documentationUrl: row.documentation_url || undefined,
      logoUrl: row.logo_url || undefined,
      category: row.category as ConnectorCatalogEntry['category'],
      priority: row.priority,
      enabled: row.enabled,
      isBeta: row.is_beta,
      maintenanceMode: row.maintenance_mode,
    }));
  } catch (error) {
    logger.error('Failed to get connector catalog', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Get connector catalog entry by provider
 */
export async function getConnectorByProvider(provider: string): Promise<ConnectorCatalogEntry | null> {
  try {
    const result = await db.query<{
      id: string;
      provider: string;
      provider_name: string;
      connector_type: string;
      supported_jurisdictions: string[];
      supported_entity_types: string[];
      auth_type: string;
      auth_config: unknown;
      required_scopes: string[];
      optional_scopes: string[];
      capabilities: unknown;
      sync_frequency_options: string[];
      default_sync_frequency: string;
      description: string | null;
      documentation_url: string | null;
      logo_url: string | null;
      category: string;
      priority: number;
      enabled: boolean;
      is_beta: boolean;
      maintenance_mode: boolean;
    }>(
      `SELECT id, provider, provider_name, connector_type, supported_jurisdictions,
              supported_entity_types, auth_type, auth_config, required_scopes,
              optional_scopes, capabilities, sync_frequency_options,
              default_sync_frequency, description, documentation_url, logo_url,
              category, priority, enabled, is_beta, maintenance_mode
       FROM connector_catalog
       WHERE provider = $1 AND enabled = true`,
      [provider]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      provider: row.provider,
      providerName: row.provider_name,
      connectorType: row.connector_type as ConnectorCatalogEntry['connectorType'],
      supportedJurisdictions: row.supported_jurisdictions || [],
      supportedEntityTypes: row.supported_entity_types || [],
      authType: row.auth_type as ConnectorCatalogEntry['authType'],
      authConfig: (row.auth_config as Record<string, unknown>) || {},
      requiredScopes: row.required_scopes || [],
      optionalScopes: row.optional_scopes || [],
      capabilities: (row.capabilities as string[]) || [],
      syncFrequencyOptions: row.sync_frequency_options || [],
      defaultSyncFrequency: row.default_sync_frequency,
      description: row.description || undefined,
      documentationUrl: row.documentation_url || undefined,
      logoUrl: row.logo_url || undefined,
      category: row.category as ConnectorCatalogEntry['category'],
      priority: row.priority,
      enabled: row.enabled,
      isBeta: row.is_beta,
      maintenanceMode: row.maintenance_mode,
    };
  } catch (error) {
    logger.error('Failed to get connector by provider', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
