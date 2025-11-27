import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { EnhancedNotificationService } from '@ai-accountant/notification-service/services/enhancedNotification';
import { matchBankStatement, BankStatement } from './bankStatementMatching';
import { ReconciliationExceptionService } from './reconciliationExceptions';

const logger = createLogger('statement-reconciliation');
const notificationService = new EnhancedNotificationService();
const exceptionService = new ReconciliationExceptionService();

export interface StatementIngestionResult {
  matchesPersisted: number;
  exceptionsRaised: number;
  notificationsSent: number;
}

/**
 * Import bank statement lines, persist match candidates, raise exceptions, and notify stakeholders.
 */
export async function reconcileStatement(
  tenantId: TenantId,
  accountId: string,
  statements: BankStatement[],
  periodStart: Date,
  periodEnd: Date
): Promise<StatementIngestionResult> {
  const matchResults = await matchBankStatement(tenantId, accountId, statements, periodStart, periodEnd);
  let matchesPersisted = 0;
  let exceptionsRaised = 0;

  for (const result of matchResults) {
    const primaryMatch = result.matchedTransactions[0];
    const matchConfidence = primaryMatch?.confidence ?? 0;
    const matchType = resolveMatchType(result.matchStatus, matchConfidence);
    const amountDifference = result.difference;

    await db.query(
      `INSERT INTO reconciliation_matches (
         tenant_id, match_type, match_confidence, bank_transaction_id,
         document_id, ledger_entry_id, bank_amount, document_amount,
         amount_difference, amount_tolerance, bank_date, document_date,
         date_difference_days, matching_criteria, matching_rules_applied,
         status, auto_matched
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, $17
       )`,
      [
        tenantId,
        matchType,
        matchConfidence,
        primaryMatch?.type === 'bank_transaction' ? primaryMatch.id : null,
        null,
        primaryMatch?.type === 'ledger_entry' ? primaryMatch.id : null,
        result.statementLine.amount,
        primaryMatch?.amount || null,
        amountDifference,
        Math.abs(result.statementLine.amount) * 0.02,
        result.statementLine.date,
        primaryMatch?.date || null,
        primaryMatch ? daysBetween(result.statementLine.date, primaryMatch.date) : null,
        JSON.stringify({ description: result.statementLine.description }),
        JSON.stringify({ rules: ['amount', 'date', 'description'] }),
        result.matchStatus === 'matched' ? 'matched' : 'pending',
        result.matchStatus === 'matched',
      ]
    );

    matchesPersisted += 1;

    if (result.matchStatus !== 'matched') {
      exceptionsRaised += 1;
      await exceptionService.createException(tenantId, {
        exceptionType: result.matchStatus === 'partial' ? 'amount_mismatch' : 'unmatched',
        severity: matchConfidence < 0.5 ? 'high' : 'medium',
        bankTransactionId: primaryMatch?.type === 'bank_transaction' ? primaryMatch.id : undefined,
        description: `Statement line ${result.statementLine.description} could not be fully reconciled`,
        anomalyScore: 1 - matchConfidence,
      });
    }
  }

  const notificationsSent = await notifyReconciliationOutcome(
    tenantId,
    matchesPersisted,
    exceptionsRaised
  );

  logger.info('Statement reconciliation completed', {
    tenantId,
    matchesPersisted,
    exceptionsRaised,
    notificationsSent,
  });

  return { matchesPersisted, exceptionsRaised, notificationsSent };
}

function resolveMatchType(status: 'matched' | 'partial' | 'unmatched', confidence: number): string {
  if (status === 'matched') return 'exact';
  if (status === 'partial') return confidence > 0.7 ? 'partial' : 'fuzzy';
  return 'manual';
}

function daysBetween(a: Date, b: Date): number {
  const diff = Math.abs(a.getTime() - b.getTime());
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

async function notifyReconciliationOutcome(
  tenantId: TenantId,
  matches: number,
  exceptions: number
): Promise<number> {
  const channels: Array<'email' | 'sms' | 'webhook'> = ['email', 'sms'];
  if (exceptions > 0) {
    channels.push('webhook');
  }

  const deliveryIds = await notificationService.sendNotification(
    tenantId,
    null,
    'reconciliation_summary',
    {
      matches,
      exceptions,
      generatedAt: new Date().toISOString(),
      webhookUrl: process.env.RECONCILIATION_WEBHOOK_URL,
    },
    channels
  );

  return deliveryIds.length;
}
