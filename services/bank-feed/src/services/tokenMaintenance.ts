import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { refreshTrueLayerConnection } from './truelayer';

const logger = createLogger('bank-feed-token-maintenance');

interface TokenRow extends Record<string, unknown> {
  id: string;
  tenant_id: TenantId;
  provider: 'plaid' | 'truelayer';
}

async function refreshExpiringConnections(): Promise<void> {
  const rows = await db.query<TokenRow>(
    `SELECT id, tenant_id, provider
     FROM bank_connections
     WHERE provider = 'truelayer'
       AND token_expires_at IS NOT NULL
       AND token_expires_at < NOW() + INTERVAL '15 minutes'
       AND is_active = true
     LIMIT 50`
  );

  for (const row of rows.rows) {
    try {
      await refreshTrueLayerConnection(row.id, row.tenant_id);
      logger.info('Refreshed TrueLayer token', { connectionId: row.id });
    } catch (error) {
      logger.error(
        'Failed to refresh TrueLayer token',
        error instanceof Error ? error : new Error(String(error)),
        { connectionId: row.id }
      );
    }
  }
}

export function startTokenMaintenance(): void {
  const cadenceMs = Number(process.env.BANK_TOKEN_REFRESH_INTERVAL_MS || 300_000);

  const run = async () => {
    try {
      await refreshExpiringConnections();
    } catch (error) {
      logger.error(
        'Token maintenance cycle failed',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  };

  // initial run
  run().catch(() => undefined);

  setInterval(run, cadenceMs);
}
