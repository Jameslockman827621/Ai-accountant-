import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { connectorService } from './connectors';
import type { ConnectorProvider } from './connectors';
import { getConnectorCatalog } from './connectorCatalog';
import { db } from '@ai-accountant/database';

const logger = createLogger('connector-provisioning-worker');

/**
 * Connector Provisioning Worker (Chunk 3)
 * Listens for onboarding.completed events and orchestrates connector connections
 */
export class ConnectorProvisioningWorker {
  /**
   * Handle onboarding completed event
   */
  async handleOnboardingCompleted(tenantId: TenantId): Promise<void> {
      try {
        logger.info('Processing onboarding completion for connector provisioning', { tenantId });

        // Get tenant's jurisdiction and entity type from intent profile
        const intentResult = await db.query<{
          primary_jurisdiction: string;
          entity_type: string;
          industry: string | null;
        }>(
          'SELECT primary_jurisdiction, entity_type, industry FROM intent_profiles WHERE tenant_id = $1',
          [tenantId]
        );

        if (intentResult.rows.length === 0) {
          logger.warn('No intent profile found for tenant', { tenantId });
          return;
        }

        const intent = intentResult.rows[0];
        const jurisdiction = intent.primary_jurisdiction;
        const entityType = intent.entity_type;

        // Get recommended connectors from catalog
        const catalog = await getConnectorCatalog(jurisdiction, entityType);

        // Prioritize connectors by category and priority
      const prioritizedConnectors = catalog
        .filter(c => c.category === 'primary')
        .sort((a, b) => b.priority - a.priority);

      // Get existing connectors
      const existingConnectors = await connectorService.getTenantConnectors(tenantId);
      const existingProviders = new Set(existingConnectors.map(c => c.provider));

      // Suggest connectors that aren't already connected
      const suggestedConnectors = prioritizedConnectors.filter(c => {
        const provider = c.provider as ConnectorProvider;
        return !existingProviders.has(provider);
      });

      logger.info('Connector suggestions generated', {
        tenantId,
        suggestedCount: suggestedConnectors.length,
        connectors: suggestedConnectors.map(c => c.provider),
      });

      // In production, this would:
      // 1. Send notifications to user about suggested connectors
      // 2. Queue connector connection prompts
      // 3. Auto-connect if user has pre-authorized

      // For now, we'll just log the suggestions
      for (const connector of suggestedConnectors.slice(0, 3)) {
        // Suggest at most 3 connectors initially
        logger.info('Suggesting connector', {
          tenantId,
          provider: connector.provider,
          type: connector.connectorType,
        });
      }
    } catch (error) {
      logger.error('Failed to process onboarding completion', error instanceof Error ? error : new Error(String(error)));
      // Don't throw - provisioning failures shouldn't block onboarding
    }
  }

  /**
   * Retry failed connector connections with exponential backoff
   */
  async retryFailedConnections(tenantId: TenantId, connectorId: string): Promise<void> {
    try {
      const connector = await connectorService.getConnector(connectorId);
      if (!connector || connector.status !== 'error') {
        return;
      }

      logger.info('Retrying failed connector connection', {
        tenantId,
        connectorId,
        provider: connector.provider,
      });

      // In production, implement exponential backoff logic
      // For now, just reset status to pending
      await db.query(
        `UPDATE connector_registry
         SET status = 'pending', updated_at = NOW()
         WHERE id = $1`,
        [connectorId]
      );
    } catch (error) {
      logger.error('Failed to retry connector connection', error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export const connectorProvisioningWorker = new ConnectorProvisioningWorker();
