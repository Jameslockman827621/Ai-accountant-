import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { syncRetryEngine } from '../services/syncRetryEngine';
import { enqueueDeadLetter } from '../../../resilience/src/services/deadLetterQueue';

const logger = createLogger('bank-feed-freshness-worker');

const STALE_HOURS = 24;
const CRITICAL_HOURS = 72;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export async function startFreshnessMonitor(): Promise<void> {
  logger.info('Starting bank feed freshness monitor');
  await checkFreshness();
  setInterval(async () => {
    try {
      await checkFreshness();
    } catch (error) {
      logger.error(
        'Failed freshness monitor cycle',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }, CHECK_INTERVAL_MS);
}

async function checkFreshness(): Promise<void> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    provider: string;
    last_sync: Date | null;
    error_count: number;
  }>(
    `SELECT id, tenant_id, provider, last_sync, error_count
     FROM bank_connections
     WHERE is_active = true
       AND (last_sync IS NULL OR last_sync < NOW() - ($1 || ' hours')::interval)
     ORDER BY last_sync NULLS FIRST`,
    [STALE_HOURS]
  );

  if (result.rows.length === 0) {
    return;
  }

  logger.warn('Detected stale bank feeds', { count: result.rows.length });

  for (const row of result.rows) {
    try {
      await syncRetryEngine.scheduleRetry(
        row.tenant_id,
        row.id,
        'Stale connection detected by freshness monitor'
      );

      // If critically stale, push to DLQ for operator review
      if (!row.last_sync || hoursSince(row.last_sync) >= CRITICAL_HOURS) {
        await enqueueDeadLetter(
          'bank-feed-service',
          {
            connectionId: row.id,
            tenantId: row.tenant_id,
            provider: row.provider,
            lastSync: row.last_sync,
          },
          'connection_stale'
        );
      }
    } catch (error) {
      logger.error('Failed to schedule retry for stale connection', {
        connectionId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function hoursSince(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}
