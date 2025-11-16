import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { connectorService } from './connectors';

const logger = createLogger('connector-health-monitoring');

/**
 * Connector Health Monitoring Service (Chunk 3)
 * Monitors connector health and raises alerts when connections are stale
 */
export class ConnectorHealthMonitoringService {
  /**
   * Check health of all active connectors
   */
  async checkAllConnectorHealth(): Promise<void> {
    try {
      logger.info('Starting connector health check');

      // Get all active connectors
      const result = await db.query<{
        id: string;
        tenant_id: string;
        provider: string;
        connector_type: string;
        connection_id: string | null;
        last_sync_at: Date | null;
        health_status: string | null;
      }>(
        `SELECT id, tenant_id, provider, connector_type, connection_id,
                last_sync_at, health_status
         FROM connector_registry
         WHERE is_enabled = true AND status = 'enabled'
         ORDER BY last_sync_at ASC NULLS FIRST`,
        []
      );

      const now = new Date();
      const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

      for (const connector of result.rows) {
        await this.checkConnectorHealth(connector.id, connector, now, staleThreshold);
      }

      logger.info('Connector health check completed', { checked: result.rows.length });
    } catch (error) {
      logger.error('Failed to check connector health', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Check health of a single connector
   */
  private async checkConnectorHealth(
    connectorId: string,
    connector: {
      provider: string;
      connector_type: string;
      connection_id: string | null;
      last_sync_at: Date | null;
      health_status: string | null;
    },
    now: Date,
    staleThreshold: number
  ): Promise<void> {
    try {
      let healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown' = 'unknown';
      let needsAlert = false;

      // Check if connector has never synced
      if (!connector.last_sync_at) {
        healthStatus = 'unknown';
        needsAlert = true;
      } else {
        // Check if last sync is stale
        const timeSinceLastSync = now.getTime() - connector.last_sync_at.getTime();
        if (timeSinceLastSync > staleThreshold) {
          healthStatus = 'unhealthy';
          needsAlert = true;
        } else if (timeSinceLastSync > staleThreshold / 2) {
          healthStatus = 'degraded';
        } else {
          healthStatus = 'healthy';
        }
      }

      // Update health status
      await connectorService.updateHealthStatus(connectorId, healthStatus);

      // Raise alert if needed
      if (needsAlert) {
        await this.raiseHealthAlert(connectorId, connector, healthStatus);
      }

      logger.debug('Connector health checked', {
        connectorId,
        provider: connector.provider,
        healthStatus,
        lastSyncAt: connector.last_sync_at,
      });
    } catch (error) {
      logger.error('Failed to check connector health', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Raise health alert for a connector
   */
  private async raiseHealthAlert(
    connectorId: string,
    connector: {
      provider: string;
      connector_type: string;
      connection_id: string | null;
    },
    healthStatus: 'unhealthy' | 'unknown'
  ): Promise<void> {
    try {
      // In production, this would:
      // 1. Create an alert in the alerts system
      // 2. Send notification to tenant admins
      // 3. Log to monitoring system

      logger.warn('Connector health alert', {
        connectorId,
        provider: connector.provider,
        type: connector.connector_type,
        healthStatus,
        connectionId: connector.connection_id,
      });

      // Update connector status if unhealthy
      if (healthStatus === 'unhealthy') {
        await db.query(
          `UPDATE connector_registry
           SET status = 'error', updated_at = NOW()
           WHERE id = $1`,
          [connectorId]
        );
      }
    } catch (error) {
      logger.error('Failed to raise health alert', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Ping a specific connector to check if it's responsive
   */
  async pingConnector(connectorId: string): Promise<boolean> {
    try {
      const connector = await connectorService.getConnector(connectorId);
      if (!connector || !connector.connectionId) {
        return false;
      }

      // In production, this would make an actual API call to the provider
      // For now, we'll just check if the connection exists
      const isHealthy = connector.status === 'enabled' && connector.connectionId !== undefined;

      if (isHealthy) {
        await connectorService.updateHealthStatus(connectorId, 'healthy', new Date());
      }

      return isHealthy;
    } catch (error) {
      logger.error('Failed to ping connector', error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }
}

export const connectorHealthMonitoring = new ConnectorHealthMonitoringService();

// Schedule daily health checks (in production, this would use a cron job or scheduler)
if (process.env.NODE_ENV !== 'test') {
  // Run health check every hour
  setInterval(() => {
    connectorHealthMonitoring.checkAllConnectorHealth().catch(error => {
      logger.error('Scheduled health check failed', error instanceof Error ? error : new Error(String(error)));
    });
  }, 60 * 60 * 1000); // 1 hour
}
