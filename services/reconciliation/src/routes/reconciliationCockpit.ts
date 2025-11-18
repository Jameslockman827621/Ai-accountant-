import { Router, Request, Response } from 'express';
import { db } from '@ai-accountant/database';
import { intelligentMatchingService } from '../services/intelligentMatching';
import { TenantId } from '@ai-accountant/shared-types';

interface AuthRequest extends Request {
  user?: {
    tenantId: TenantId;
    userId: string;
  };
}

const router = Router();

/**
 * GET /api/reconciliation/transactions
 * Get bank transactions with match suggestions
 */
router.get('/transactions', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { accountId, startDate, endDate } = req.query;

    let query = `
      SELECT id, date, amount, currency, description, category, reconciled,
             reconciled_with_document, reconciled_with_ledger, metadata
      FROM bank_transactions
      WHERE tenant_id = $1
    `;
    const params: unknown[] = [req.user.tenantId];
    let paramCount = 2;

    if (accountId) {
      query += ` AND account_id = $${paramCount++}`;
      params.push(accountId);
    }

    if (startDate) {
      query += ` AND date >= $${paramCount++}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND date <= $${paramCount++}`;
      params.push(endDate);
    }

    query += ` ORDER BY date DESC LIMIT 500`;

    const result = await db.query<
      {
        id: string;
        date: Date;
        amount: number | string;
        currency: string;
        description: string;
        category: string | null;
        reconciled: boolean;
        reconciled_with_document: string | null;
        reconciled_with_ledger: string | null;
        metadata: unknown;
      }
    >(query, params);

    // Enrich with match suggestions
    const transactions = await Promise.all(
      result.rows.map(async (tx) => {
        let suggestedMatch = null;

        if (!tx.reconciled) {
          const matches = await intelligentMatchingService.findMatches(
            req.user!.tenantId,
            tx.id
          );
          const firstMatch = matches[0];
          if (firstMatch && firstMatch.matchType !== 'manual') {
            suggestedMatch = firstMatch;
          }
        }

        // Check metadata for stored suggestions
        const metadata = (tx.metadata as Record<string, unknown>) ?? {};
        if (metadata.suggested_match) {
          suggestedMatch = metadata.suggested_match as typeof suggestedMatch;
        }

        return {
          id: tx.id,
          date: tx.date.toISOString(),
          amount: typeof tx.amount === 'number' ? tx.amount : parseFloat(String(tx.amount)),
          currency: tx.currency,
          description: tx.description,
          category: tx.category,
          reconciled: tx.reconciled,
          suggestedMatch,
        };
      })
    );

    res.json({ transactions });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

/**
 * GET /api/reconciliation/events
 * Get reconciliation events for timeline
 */
router.get('/events', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate, limit = 100 } = req.query;

    let query = `
      SELECT id, event_type, reason_code, reason_description, confidence_score,
             performed_at, performed_by, match_signals
      FROM reconciliation_events
      WHERE tenant_id = $1
    `;
    const params: unknown[] = [req.user.tenantId];
    let paramCount = 2;

    if (startDate) {
      query += ` AND performed_at >= $${paramCount++}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND performed_at <= $${paramCount++}`;
      params.push(endDate);
    }

    query += ` ORDER BY performed_at DESC LIMIT $${paramCount++}`;
    params.push(parseInt(limit as string, 10));

    const result = await db.query<{
      id: string;
      event_type: string;
      reason_code: string;
      reason_description: string | null;
      confidence_score: number | string | null;
      performed_at: Date;
      performed_by: string | null;
      match_signals: unknown;
    }>(query, params);

    const events = result.rows.map((row) => {
      const event: {
        id: string;
        eventType: string;
        reasonCode: string;
        reasonDescription?: string;
        confidenceScore?: number;
        performedAt: string;
        performedBy?: string;
        matchSignals: Record<string, unknown>;
      } = {
        id: row.id,
        eventType: row.event_type,
        reasonCode: row.reason_code,
        performedAt: row.performed_at.toISOString(),
        matchSignals: (row.match_signals as Record<string, unknown>) ?? {},
      };

      if (row.reason_description) {
        event.reasonDescription = row.reason_description;
      }
      if (row.confidence_score !== null && row.confidence_score !== undefined) {
        event.confidenceScore =
          typeof row.confidence_score === 'number'
            ? row.confidence_score
            : parseFloat(String(row.confidence_score));
      }
      if (row.performed_by) {
        event.performedBy = row.performed_by;
      }

      return event;
    });

    res.json({ events });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

/**
 * POST /api/reconciliation/match
 * Accept a match suggestion
 */
router.post('/match', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { bankTransactionId, documentId, ledgerEntryId, matchType } = req.body;

    if (!bankTransactionId || (!documentId && !ledgerEntryId)) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Reconcile transaction
    await db.transaction(async (client) => {
      await client.query(
        `UPDATE bank_transactions
         SET reconciled = true,
             reconciled_with_document = $1,
             reconciled_with_ledger = $2,
             updated_at = NOW()
         WHERE id = $3 AND tenant_id = $4`,
        [documentId || null, ledgerEntryId || null, bankTransactionId, req.user!.tenantId]
      );

      if (documentId) {
        await client.query(
          `UPDATE documents
           SET status = 'posted', updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2`,
          [documentId, req.user!.tenantId]
        );
      }

      if (ledgerEntryId) {
        await client.query(
          `UPDATE ledger_entries
           SET reconciled = true, reconciled_with = $1, updated_at = NOW()
           WHERE id = $2 AND tenant_id = $3`,
          [bankTransactionId, ledgerEntryId, req.user!.tenantId]
        );
      }
    });

    // Record event
    const matches = await intelligentMatchingService.findMatches(
      req.user.tenantId,
      bankTransactionId
    );
    const bestMatch = matches[0];

    const eventPayload: {
      bankTransactionId?: string;
      documentId?: string;
      ledgerEntryId?: string;
      eventType: 'match' | 'unmatch' | 'auto_match' | 'manual_match' | 'split' | 'merge' | 'exception_created' | 'exception_resolved';
      reasonCode: string;
      reasonDescription?: string;
      confidenceScore?: number;
      matchSignals?: unknown;
      performedBy?: string;
    } = {
      eventType: matchType === 'auto' ? 'auto_match' : 'manual_match',
      reasonCode: 'user_accepted_match',
      reasonDescription: `User accepted ${matchType} match`,
    };

    if (bankTransactionId) {
      eventPayload.bankTransactionId = bankTransactionId;
    }
    if (req.user.userId) {
      eventPayload.performedBy = req.user.userId;
    }

    if (documentId) {
      eventPayload.documentId = documentId;
    }
    if (ledgerEntryId) {
      eventPayload.ledgerEntryId = ledgerEntryId;
    }
    if (bestMatch) {
      eventPayload.confidenceScore = bestMatch.confidenceScore;
      // matchSignals is optional and may not match the exact type
      // We'll let the service handle the type conversion
    }

    await intelligentMatchingService.recordEvent(req.user.tenantId, eventPayload);

    res.json({ success: true });
  } catch (error) {
    console.error('Error accepting match:', error);
    res.status(500).json({ error: 'Failed to accept match' });
  }
});

/**
 * POST /api/reconciliation/reject
 * Reject a match suggestion
 */
router.post('/reject', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { bankTransactionId } = req.body;

    if (!bankTransactionId) {
      res.status(400).json({ error: 'Missing bankTransactionId' });
      return;
    }

    // Clear suggested match from metadata
    await db.query(
      `UPDATE bank_transactions
       SET metadata = metadata - 'suggested_match', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [bankTransactionId, req.user.tenantId]
    );

    // Record event
    await intelligentMatchingService.recordEvent(req.user.tenantId, {
      bankTransactionId,
      eventType: 'unmatch',
      reasonCode: 'user_rejected_match',
      reasonDescription: 'User rejected suggested match',
      performedBy: req.user.userId,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error rejecting match:', error);
    res.status(500).json({ error: 'Failed to reject match' });
  }
});

/**
 * GET /api/reconciliation/anomalies
 * Get detected anomalies
 */
router.get('/anomalies', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate, minScore } = req.query;

    // Import here to avoid circular dependency
    const { anomalyDetectionService } = await import('../services/anomalyDetection');

    const options: {
      startDate?: Date;
      endDate?: Date;
      minScore?: number;
    } = {};

    if (startDate) {
      options.startDate = new Date(startDate as string);
    }
    if (endDate) {
      options.endDate = new Date(endDate as string);
    }
    if (minScore) {
      options.minScore = parseFloat(minScore as string);
    }

    const anomalies = await anomalyDetectionService.detectAnomalies(req.user.tenantId, options);

    res.json({ anomalies });
  } catch (error) {
    console.error('Error fetching anomalies:', error);
    res.status(500).json({ error: 'Failed to fetch anomalies' });
  }
});

export { router as reconciliationCockpitRouter };
