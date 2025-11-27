import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';
import { enqueueDeadLetter } from '../../../resilience/src/services/deadLetterQueue';

export async function isDuplicateTransaction(
  tenantId: TenantId,
  accountId: string,
  amount: number,
  date: string,
  description: string
): Promise<boolean> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM bank_transactions
     WHERE tenant_id = $1
       AND account_id = $2
       AND date = $3
       AND ABS(amount - $4) < 0.01
       AND lower(description) = lower($5)`,
    [tenantId, accountId, date, amount, description]
  );

  return parseInt(result.rows[0]?.count || '0', 10) > 0;
}

export async function handleDuplicateTransaction(
  tenantId: TenantId,
  connectionId: string,
  transaction: Record<string, unknown>,
  reason = 'potential_duplicate'
): Promise<void> {
  await enqueueDeadLetter(
    'bank-feed-service',
    {
      connectionId,
      tenantId,
      transaction,
    },
    reason
  );
}
