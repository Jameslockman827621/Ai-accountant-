import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { db } from '@ai-accountant/database';
import { FilingType, FilingStatus } from '@ai-accountant/shared-types';
import { generateVATFiling } from '../services/hmrc';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('filing-service');

// Create filing
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filingType, periodStart, periodEnd } = req.body;

    if (!filingType || !periodStart || !periodEnd) {
      throw new ValidationError('Filing type, period start, and period end are required');
    }

    // Generate filing data based on type
    let filingData: Record<string, unknown>;
    if (filingType === FilingType.VAT) {
      filingData = await generateVATFiling(req.user.tenantId, new Date(periodStart), new Date(periodEnd));
    } else {
      throw new ValidationError(`Filing type ${filingType} not yet supported`);
    }

    const filingId = randomUUID();

    const result = await db.query(
      `INSERT INTO filings (
        id, tenant_id, filing_type, status, period_start, period_end,
        filing_data, calculated_by, model_version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        filingId,
        req.user.tenantId,
        filingType,
        FilingStatus.DRAFT,
        new Date(periodStart),
        new Date(periodEnd),
        JSON.stringify(filingData),
        req.user.userId,
        '1.0.0',
      ]
    );

    logger.info('Filing created', { filingId, tenantId: req.user.tenantId });

    res.status(201).json({ filing: result.rows[0] });
  } catch (error) {
    logger.error('Create filing failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create filing' });
  }
});

// Get filings
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, filingType } = req.query;

    let query = 'SELECT * FROM filings WHERE tenant_id = $1';
    const params: unknown[] = [req.user.tenantId];
    let paramCount = 2;

    if (status) {
      query += ` AND status = $${paramCount++}`;
      params.push(status);
    }

    if (filingType) {
      query += ` AND filing_type = $${paramCount++}`;
      params.push(filingType);
    }

    query += ' ORDER BY created_at DESC';

    const result = await db.query(query, params);

    res.json({ filings: result.rows });
  } catch (error) {
    logger.error('Get filings failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get filings' });
  }
});

// Get filing by ID
router.get('/:filingId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filingId } = req.params;

    const result = await db.query(
      'SELECT * FROM filings WHERE id = $1 AND tenant_id = $2',
      [filingId, req.user.tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Filing not found' });
      return;
    }

    res.json({ filing: result.rows[0] });
  } catch (error) {
    logger.error('Get filing failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get filing' });
  }
});

// Submit filing
router.post('/:filingId/submit', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filingId } = req.params;

    // Get filing
    const filingResult = await db.query(
      'SELECT * FROM filings WHERE id = $1 AND tenant_id = $2',
      [filingId, req.user.tenantId]
    );

    if (filingResult.rows.length === 0) {
      res.status(404).json({ error: 'Filing not found' });
      return;
    }

    const filing = filingResult.rows[0] as {
      id: string;
      status: string;
    } | undefined;

    if (!filing) {
      res.status(404).json({ error: 'Filing not found' });
      return;
    }

    if (filing.status !== FilingStatus.DRAFT && filing.status !== FilingStatus.PENDING_APPROVAL) {
      throw new ValidationError('Filing can only be submitted from draft or pending approval status');
    }

    // Update status to submitted
    // In production, this would call HMRC API
    await db.query(
      `UPDATE filings
       SET status = $1, submitted_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [FilingStatus.SUBMITTED, filingId]
    );

    logger.info('Filing submitted', { filingId, tenantId: req.user.tenantId });

    res.json({ message: 'Filing submitted successfully' });
  } catch (error) {
    logger.error('Submit filing failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to submit filing' });
  }
});

export { router as filingRouter };
