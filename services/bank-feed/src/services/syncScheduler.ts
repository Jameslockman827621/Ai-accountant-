import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { createPlaidService } from '../../onboarding/src/services/oauth/plaid';
import { createTrueLayerService } from '../../onboarding/src/services/oauth/truelayer';

const logger = createLogger('bank-feed-scheduler');

interface SyncJob {
  connectorId: string;
  tenantId: string;
  provider: string;
  nextSyncAt: Date;
}

export class BankFeedSyncScheduler {
  private syncInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start the sync scheduler
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Sync scheduler already running');
      return;
    }

    this.isRunning = true;
    // Run every 5 minutes to check for syncs due
    this.syncInterval = setInterval(() => {
      void this.processDueSyncs();
    }, 5 * 60 * 1000);

    // Also run immediately
    void this.processDueSyncs();

    logger.info('Bank feed sync scheduler started');
  }

  /**
   * Stop the sync scheduler
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.isRunning = false;
    logger.info('Bank feed sync scheduler stopped');
  }

  /**
   * Process syncs that are due
   */
  private async processDueSyncs(): Promise<void> {
    try {
      const dueSyncs = await this.getDueSyncs();

      for (const sync of dueSyncs) {
        try {
          await this.executeSync(sync);
        } catch (error) {
          logger.error('Sync execution failed', {
            connectorId: sync.connectorId,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    } catch (error) {
      logger.error('Failed to process due syncs', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get syncs that are due
   */
  private async getDueSyncs(): Promise<SyncJob[]> {
    const result = await db.query<{
      id: string;
      connector_id: string;
      tenant_id: string;
      provider: string;
      next_sync_at: Date;
    }>(
      `SELECT cs.id, cs.connector_id, cs.tenant_id, cr.provider, cs.next_sync_at
       FROM connector_sync_schedule cs
       JOIN connector_registry cr ON cr.id = cs.connector_id
       WHERE cs.is_active = true
         AND cs.connector_id IN (
           SELECT id FROM connector_registry
           WHERE connector_type = 'bank' AND status = 'enabled'
         )
         AND (cs.next_sync_at IS NULL OR cs.next_sync_at <= NOW())
         AND (cs.paused_until IS NULL OR cs.paused_until <= NOW())
       ORDER BY cs.next_sync_at ASC
       LIMIT 50`,
      []
    );

    return result.rows.map(row => ({
      connectorId: row.connector_id,
      tenantId: row.tenant_id,
      provider: row.provider,
      nextSyncAt: row.next_sync_at,
    }));
  }

  /**
   * Execute a sync
   */
  private async executeSync(sync: SyncJob): Promise<void> {
    const startTime = Date.now();

    try {
      logger.info('Starting bank feed sync', {
        connectorId: sync.connectorId,
        tenantId: sync.tenantId,
        provider: sync.provider,
      });

      // Get connector details
      const connectorResult = await db.query<{
        connection_id: string;
        credential_store_key: string;
        configuration: unknown;
      }>(
        'SELECT connection_id, credential_store_key, configuration FROM connector_registry WHERE id = $1',
        [sync.connectorId]
      );

      if (connectorResult.rows.length === 0) {
        throw new Error('Connector not found');
      }

      const connector = connectorResult.rows[0];
      const config = connector.configuration as Record<string, unknown>;

      // Execute sync based on provider
      let syncResult: { success: boolean; transactionCount: number; error?: string };
      
      switch (sync.provider) {
        case 'plaid':
          syncResult = await this.syncPlaid(sync.tenantId, connector.connection_id, config);
          break;
        case 'truelayer':
          syncResult = await this.syncTrueLayer(sync.tenantId, connector.connection_id, config);
          break;
        default:
          throw new Error(`Unsupported provider: ${sync.provider}`);
      }

      const duration = Date.now() - startTime;

      // Update sync schedule
      await this.updateSyncSchedule(
        sync.connectorId,
        syncResult.success,
        syncResult.transactionCount,
        duration,
        syncResult.error
      );

      logger.info('Bank feed sync completed', {
        connectorId: sync.connectorId,
        success: syncResult.success,
        transactionCount: syncResult.transactionCount,
        duration,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.updateSyncSchedule(sync.connectorId, false, 0, duration, errorMessage);

      logger.error('Bank feed sync failed', {
        connectorId: sync.connectorId,
        error: errorMessage,
        duration,
      });

      throw error;
    }
  }

  /**
   * Sync Plaid account
   */
  private async syncPlaid(
    tenantId: string,
    connectionId: string,
    config: Record<string, unknown>
  ): Promise<{ success: boolean; transactionCount: number; error?: string }> {
    try {
      // In production, would use actual Plaid service
      // For now, simulate sync
      const plaidService = createPlaidService({
        clientId: config.clientId as string,
        secret: config.secret as string,
        environment: (config.environment as 'sandbox' | 'production') || 'sandbox',
        redirectUri: config.redirectUri as string,
      });

      // Get transactions for last 30 days
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      // In production, would fetch actual transactions
      // const transactions = await plaidService.getTransactions(accessToken, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]);

      // Simulate transaction processing
      const transactionCount = 0; // Would be actual count

      return {
        success: true,
        transactionCount,
      };
    } catch (error) {
      return {
        success: false,
        transactionCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Sync TrueLayer account
   */
  private async syncTrueLayer(
    tenantId: string,
    connectionId: string,
    config: Record<string, unknown>
  ): Promise<{ success: boolean; transactionCount: number; error?: string }> {
    try {
      // In production, would use actual TrueLayer service
      const trueLayerService = createTrueLayerService({
        clientId: config.clientId as string,
        clientSecret: config.clientSecret as string,
        redirectUri: config.redirectUri as string,
        environment: (config.environment as 'sandbox' | 'live') || 'sandbox',
      });

      // Simulate transaction processing
      const transactionCount = 0; // Would be actual count

      return {
        success: true,
        transactionCount,
      };
    } catch (error) {
      return {
        success: false,
        transactionCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update sync schedule after sync
   */
  private async updateSyncSchedule(
    connectorId: string,
    success: boolean,
    transactionCount: number,
    durationMs: number,
    error?: string
  ): Promise<void> {
    const scheduleResult = await db.query<{
      sync_frequency: string;
      sync_interval_minutes: number;
    }>(
      'SELECT sync_frequency, sync_interval_minutes FROM connector_sync_schedule WHERE connector_id = $1',
      [connectorId]
    );

    if (scheduleResult.rows.length === 0) {
      return;
    }

    const schedule = scheduleResult.rows[0];
    let nextSyncAt = new Date();

    // Calculate next sync time based on frequency
    switch (schedule.sync_frequency) {
      case 'realtime':
        nextSyncAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
        break;
      case 'hourly':
        nextSyncAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        break;
      case 'daily':
        nextSyncAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        break;
      case 'custom':
        nextSyncAt = new Date(Date.now() + (schedule.sync_interval_minutes || 60) * 60 * 1000);
        break;
    }

    await db.query(
      `UPDATE connector_sync_schedule
       SET last_sync_at = NOW(),
           last_sync_status = $1,
           last_sync_error = $2,
           next_sync_at = $3,
           total_syncs = total_syncs + 1,
           successful_syncs = successful_syncs + CASE WHEN $1 = 'success' THEN 1 ELSE 0 END,
           failed_syncs = failed_syncs + CASE WHEN $1 != 'success' THEN 1 ELSE 0 END,
           avg_sync_duration_ms = (
             (avg_sync_duration_ms * (total_syncs - 1) + $4) / total_syncs
           ),
           updated_at = NOW()
       WHERE connector_id = $5`,
      [
        success ? 'success' : 'failed',
        error || null,
        nextSyncAt,
        durationMs,
        connectorId,
      ]
    );
  }
}

export const syncScheduler = new BankFeedSyncScheduler();
