import { Router, Request, Response } from 'express';
import { db } from '@ai-accountant/database';
import { intelligentMatchingService } from '../services/intelligentMatching';
import { reconciliationExceptionService } from '../services/reconciliationExceptions';
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
router.get('/transactions', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
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

    const result = await db.query(query, params);

    // Enrich with match suggestions
    const transactions = await Promise.all(
      result.rows.map(async (tx: {
        id: string;
        date: Date;
        amount: number;
        currency: string;
        description: string;
        category: string | null;
        reconciled: boolean;
        reconciled_with_document: string | null;
        reconciled_with_ledger: string | null;
        metadata: unknown;
      }) => {
        let suggestedMatch = null;

        if (!tx.reconciled) {
          const matches = await intelligentMatchingService.findMatches(
            req.user!.tenantId,
            tx.id
          );
          if (matches.length > 0 && matches[0].matchType !== 'manual') {
            suggestedMatch = matches[0];
          }
        }

        // Check metadata for stored suggestions
        const metadata = (tx.metadata as Record<string, unknown>) || {};
        if (metadata.suggested_match) {
          suggestedMatch = metadata.suggested_match as typeof suggestedMatch;
        }

        return {
          id: tx.id,
          date: tx.date.toISOString(),
          amount: parseFloat(tx.amount.toString()),
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
router.get('/events', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { accountId, startDate, endDate, limit = 100 } = req.query;

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

    const result = await db.query(query, params);

    const events = result.rows.map((row: {
      id: string;
      event_type: string;
      reason_code: string;
      reason_description: string | null;
      confidence_score: number | null;
      performed_at: Date;
      performed_by: string | null;
      match_signals: unknown;
    }) => ({
      id: row.id,
      eventType: row.event_type,
      reasonCode: row.reason_code,
      reasonDescription: row.reason_description || undefined,
      confidenceScore: row.confidence_score ? parseFloat(row.confidence_score.toString()) : undefined,
      performedAt: row.performed_at.toISOString(),
      performedBy: row.performed_by || undefined,
      matchSignals: row.match_signals || {},
    }));

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
router.post('/match', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { bankTransactionId, documentId, ledgerEntryId, matchType } = req.body;

    if (!bankTransactionId || (!documentId && !ledgerEntryId)) {
      return res.status(400).json({ error: 'Missing required fields' });
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

    await intelligentMatchingService.recordEvent(req.user.tenantId, {
      bankTransactionId,
      documentId,
      ledgerEntryId,
      eventType: matchType === 'auto' ? 'auto_match' : 'manual_match',
      reasonCode: 'user_accepted_match',
      reasonDescription: `User accepted ${matchType} match`,
      confidenceScore: bestMatch?.confidenceScore,
      matchSignals: bestMatch?.signals,
      performedBy: req.user.userId,
    });

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
router.post('/reject', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { bankTransactionId } = req.body;

    if (!bankTransactionId) {
      return res.status(400).json({ error: 'Missing bankTransactionId' });
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
router.get('/anomalies', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { startDate, endDate, minScore } = req.query;

    // Import here to avoid circular dependency
    const { anomalyDetectionService } = await import('../services/anomalyDetection');

    const anomalies = await anomalyDetectionService.detectAnomalies(req.user.tenantId, {
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      minScore: minScore ? parseFloat(minScore as string) : undefined,
    });

    res.json({ anomalies });
  } catch (error) {
    console.error('Error fetching anomalies:', error);
    res.status(500).json({ error: 'Failed to fetch anomalies' });
  }
});

export { router as reconciliationCockpitRouter };
