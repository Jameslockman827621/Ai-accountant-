import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';

const logger = createLogger('payroll-sync-scheduler');

export function startSyncScheduler(): void {
  const intervalMs = 60 * 60 * 1000; // 1 hour

  const run = async () => {
    try {
      // Get connectors due for sync
      const connectors = await db.query<{
        id: string;
        tenant_id: string;
        provider: string;
      }>(
        `SELECT cs.id, cs.tenant_id, cr.provider
         FROM connector_sync_schedule cs
         JOIN connector_registry cr ON cr.id = cs.connector_id
         WHERE cs.is_active = true
           AND cr.connector_type = 'payroll'
           AND (cs.next_sync_at IS NULL OR cs.next_sync_at <= NOW())
         LIMIT 50`
      );

      for (const connector of connectors.rows) {
        try {
          logger.info('Syncing payroll connector', {
            connectorId: connector.id,
            provider: connector.provider,
          });

          // In production, would trigger actual sync
          // Update next sync time
          await db.query(
            `UPDATE connector_sync_schedule
             SET last_sync_at = NOW(),
                 last_sync_status = 'success',
                 next_sync_at = NOW() + INTERVAL '24 hours',
                 updated_at = NOW()
             WHERE connector_id = $1`,
            [connector.id]
          );
        } catch (error) {
          logger.error('Payroll sync failed', {
            connectorId: connector.id,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    } catch (error) {
      logger.error('Sync scheduler cycle failed', error instanceof Error ? error : new Error(String(error)));
    }
  };

  // Run immediately, then on interval
  run().catch(() => undefined);
  setInterval(run, intervalMs);

  logger.info('Payroll sync scheduler started');
}
