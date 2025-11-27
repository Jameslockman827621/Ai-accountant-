import { createLogger } from '@ai-accountant/shared-utils';
import { syncRetryEngine } from '../services/syncRetryEngine';
import { syncPlaidTransactions } from '../services/plaid';
import { fetchTrueLayerTransactions } from '../services/truelayer';
import { getConnectionSecrets } from '../services/connectionStore';
import { db } from '@ai-accountant/database';
import {
  fetchDeadLetters,
  markDeadLetterResolved,
  markDeadLetterRetry,
} from '../../../resilience/src/services/deadLetterQueue';

const logger = createLogger('bank-feed-retry-worker');
const RETRY_INTERVAL_MS = 60000; // Check every minute
const MAX_CONCURRENT_RETRIES = 5;

/**
 * Worker process that executes scheduled bank sync retries
 * Runs continuously, checking for pending retries and executing them
 */
export async function startRetryWorker(): Promise<void> {
  logger.info('Bank feed retry worker started');

  // Process retries immediately, then on interval
  await processRetries();
  await processDeadLetters();

  setInterval(async () => {
    try {
      await processRetries();
      await processDeadLetters();
    } catch (error) {
      logger.error('Error in retry worker cycle', error instanceof Error ? error : new Error(String(error)));
    }
  }, RETRY_INTERVAL_MS);
}

async function processDeadLetters(): Promise<void> {
  const messages = await fetchDeadLetters('bank-feed-service', MAX_CONCURRENT_RETRIES);
  if (messages.length === 0) {
    return;
  }

  logger.info('Processing bank-feed DLQ messages', { count: messages.length });

  for (const message of messages) {
    try {
      const { connectionId, tenantId } = message.payload as { connectionId: string; tenantId: string };
      if (!connectionId || !tenantId) {
        await markDeadLetterRetry(message.id, { error: 'Missing connection context' });
        continue;
      }

      await syncRetryEngine.scheduleRetry(
        tenantId as string,
        connectionId as string,
        `Auto-retry from DLQ: ${message.reason}`
      );

      await markDeadLetterResolved(message.id);
    } catch (error) {
      await markDeadLetterRetry(message.id, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function processRetries(): Promise<void> {
  try {
    const pendingRetries = await syncRetryEngine.getPendingRetries(MAX_CONCURRENT_RETRIES);

    if (pendingRetries.length === 0) {
      return;
    }

    logger.info('Processing bank sync retries', { count: pendingRetries.length });

    // Process retries in parallel (with limit)
    const retryPromises = pendingRetries.map(retry => executeRetry(retry));
    await Promise.allSettled(retryPromises);
  } catch (error) {
    logger.error('Failed to process retries', error instanceof Error ? error : new Error(String(error)));
  }
}

async function executeRetry(retry: { id: string; connectionId: string; tenantId: string }): Promise<void> {
  try {
    // Mark as retrying
    await db.query(
      `UPDATE bank_sync_retries
       SET status = 'retrying', updated_at = NOW()
       WHERE id = $1`,
      [retry.id]
    );

    // Get connection details
    const connectionResult = await db.query<{
      provider: string;
      tenant_id: string;
    }>(
      `SELECT provider, tenant_id
       FROM bank_connections
       WHERE id = $1 AND tenant_id = $2`,
      [retry.connectionId, retry.tenantId]
    );

    if (connectionResult.rows.length === 0) {
      throw new Error('Connection not found');
    }

    const connection = connectionResult.rows[0];
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 30); // Last 30 days

    // Execute sync based on provider
    if (connection.provider === 'plaid') {
      await syncPlaidTransactions(
        retry.tenantId,
        retry.connectionId,
        startDate,
        now
      );
    } else if (connection.provider === 'truelayer') {
      const secrets = await getConnectionSecrets(retry.connectionId, retry.tenantId);
      let accountId = secrets.metadata?.accountId as string | undefined;
      
      // If accountId not in metadata, try to get from connection or transactions
      if (!accountId) {
        const accountsResult = await db.query<{
          provider_account_id: string;
        }>(
          `SELECT DISTINCT provider_account_id
           FROM bank_transactions
           WHERE tenant_id = $1
           UNION
           SELECT provider_account_id
           FROM bank_connections
           WHERE id = $2 AND tenant_id = $1 AND provider_account_id IS NOT NULL
           LIMIT 1`,
          [retry.tenantId, retry.connectionId]
        );

        if (accountsResult.rows.length === 0) {
          throw new Error('No accounts found for TrueLayer connection');
        }

        accountId = accountsResult.rows[0].provider_account_id;
      }

      await fetchTrueLayerTransactions(
        retry.connectionId,
        retry.tenantId,
        accountId,
        startDate,
        now
      );
    } else {
      throw new Error(`Unknown provider: ${connection.provider}`);
    }

    // Mark as succeeded
    await syncRetryEngine.markSucceeded(retry.id);
    logger.info('Sync retry succeeded', { retryId: retry.id, connectionId: retry.connectionId });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Sync retry failed', {
      retryId: retry.id,
      connectionId: retry.connectionId,
      error: errorMessage,
    });

    // Schedule another retry if not at max
    try {
      await syncRetryEngine.scheduleRetry(retry.tenantId, retry.connectionId, errorMessage);
    } catch (retryError) {
      // Max retries reached, mark as failed
      await syncRetryEngine.markFailed(retry.id);
      logger.warn('Max retries reached for sync', { retryId: retry.id });
    }
  }
}

// Start worker if this file is run directly
if (require.main === module) {
  startRetryWorker().catch(error => {
    logger.error('Failed to start retry worker', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  });
}
