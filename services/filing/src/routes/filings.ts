import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { db } from '@ai-accountant/database';
import { FilingType, FilingStatus } from '@ai-accountant/shared-types';
import { generateVATFiling } from '../services/hmrc';
import { ValidationError } from '@ai-accountant/shared-utils';
import {
  createFilingReview,
  getFilingReviewChecklist,
  approveFilingReview,
  rejectFilingReview,
} from '../services/filingReview';
import {
  submitTenantVatReturn,
  SubmissionType,
} from '../services/hmrcSubmission';
import {
  createAmendmentDraft,
  getDraftAmendmentSubmission,
  listFilingSubmissions,
} from '../services/filingSubmissions';
import { VATReturnPayload } from '@ai-accountant/hmrc';

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
    } else if (filingType === FilingType.PAYE) {
      const { generatePAYEFiling } = await import('../services/payeCalculation');
      filingData = await generatePAYEFiling(req.user.tenantId, new Date(periodStart), new Date(periodEnd));
    } else if (filingType === FilingType.CORPORATION_TAX) {
      const { generateCorporationTaxFiling } = await import('../services/corporationTaxCalculation');
      filingData = await generateCorporationTaxFiling(req.user.tenantId, new Date(periodStart), new Date(periodEnd));
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

// Attest filing
router.post('/:filingId/attest', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filingId } = req.params;
    const { attestedByName, attestedByRole, statement } = req.body;

    if (!attestedByName || !statement) {
      throw new ValidationError('attestedByName and statement are required');
    }

    const result = await db.query(
      `INSERT INTO filing_attestations (
         filing_id,
         tenant_id,
         attested_by,
         attested_by_name,
         attested_by_role,
         statement
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (filing_id) DO UPDATE
       SET attested_by = EXCLUDED.attested_by,
           attested_by_name = EXCLUDED.attested_by_name,
           attested_by_role = EXCLUDED.attested_by_role,
           statement = EXCLUDED.statement,
           created_at = NOW()
       RETURNING id, attested_by_name, attested_by_role, statement, created_at`,
      [
        filingId,
        req.user.tenantId,
        req.user.userId,
        attestedByName,
        attestedByRole || null,
        statement,
      ]
    );

    res.status(201).json({ attestation: result.rows[0] });
  } catch (error) {
    logger.error('Attest filing failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to attest filing' });
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

router.get('/receipts', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1),
      50
    );

    const result = await db.query<{
      id: string;
      filing_id: string;
      submission_id: string;
      payload: Record<string, unknown> | null;
      received_at: Date;
      filing_type: FilingType;
      status: FilingStatus;
    }>(
      `SELECT r.id,
              r.filing_id,
              r.submission_id,
              r.payload,
              r.received_at,
              f.filing_type,
              f.status
         FROM filing_receipts r
         JOIN filings f ON f.id = r.filing_id
        WHERE r.tenant_id = $1
        ORDER BY r.received_at DESC
        LIMIT $2`,
      [req.user.tenantId, limit]
    );

    const receipts = result.rows.map((row) => ({
      id: row.id,
      filingId: row.filing_id,
      submissionId: row.submission_id,
      filingType: row.filing_type,
      filingStatus: row.status,
      receivedAt: row.received_at,
      hmrcReference:
        (row.payload?.['receiptId'] as string | undefined) ||
        (row.payload?.['formBundleNumber'] as string | undefined) ||
        row.submission_id,
      payload: row.payload,
    }));

    res.json({ receipts });
  } catch (error) {
    logger.error('Get filing receipts failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to fetch filing receipts' });
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
    const filingResult = await db.query<{
      id: string;
      status: FilingStatus;
      filing_data: Record<string, unknown>;
      last_submission_id: string | null;
    }>(
      `SELECT id, status, filing_data, last_submission_id
       FROM filings
       WHERE id = $1 AND tenant_id = $2`,
      [filingId, req.user.tenantId]
    );

    if (filingResult.rows.length === 0) {
      res.status(404).json({ error: 'Filing not found' });
      return;
    }

    const filing = filingResult.rows[0];
    if (!filing) {
      res.status(404).json({ error: 'Filing not found' });
      return;
    }

      if (filing.status !== FilingStatus.PENDING_APPROVAL) {
        throw new ValidationError('Filing must be reviewed and approved before submission');
      }

      const reviewResult = await db.query<{
        review_status: string;
        validation_results: { status?: string } | null;
      }>(
        `SELECT review_status, validation_results
         FROM filing_reviews
         WHERE filing_id = $1
         ORDER BY updated_at DESC
         LIMIT 1`,
        [filingId]
      );

      if (
        reviewResult.rows.length === 0 ||
        reviewResult.rows[0].review_status !== 'approved'
      ) {
        throw new ValidationError('Filing must have an approved review before submission');
      }

      if (reviewResult.rows[0].validation_results?.status === 'fail') {
        throw new ValidationError('Validation checks failed. Please resolve issues before submission.');
      }

    const filingData = filing.filing_data as unknown as VATReturnPayload;

    const amendmentDraft = await getDraftAmendmentSubmission(
      req.user.tenantId,
      filingId
    );

    let submissionType: SubmissionType = 'initial';
    let reuseSubmissionRecordId: string | undefined;
    let parentSubmissionId: string | null = filing.last_submission_id;

    if (amendmentDraft) {
      submissionType = 'amendment';
      reuseSubmissionRecordId = amendmentDraft.id;
      parentSubmissionId =
        amendmentDraft.parentSubmissionId || parentSubmissionId || null;
    } else if (parentSubmissionId) {
      submissionType = 'resubmission';
    }

    const submissionResult = await submitTenantVatReturn({
      filingId,
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      payload: filingData,
      submissionType,
      reuseSubmissionRecordId,
      parentSubmissionId,
    });

    await db.query(
      `UPDATE filings
       SET filing_data = jsonb_set(
             jsonb_set(filing_data, '{submissionId}', $2::jsonb),
             '{processingDate}',
             $3::jsonb
           )
       WHERE id = $1`,
      [
        filingId,
        JSON.stringify(submissionResult.hmrcSubmissionId),
        JSON.stringify(submissionResult.processingDate),
      ]
    );

    res.json({
      message: 'Filing submitted successfully',
      submissionId: submissionResult.hmrcSubmissionId,
      receiptId: submissionResult.receiptId,
      processingDate: submissionResult.processingDate,
    });
  } catch (error) {
    logger.error('Submit filing failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to submit filing' });
  }
});

router.post('/:filingId/amend', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filingId } = req.params;
    const { adjustments, reason } = req.body;

    if (!adjustments || typeof adjustments !== 'object') {
      throw new ValidationError('adjustments object is required');
    }

    const filingResult = await db.query<{
      id: string;
      status: FilingStatus;
      filing_data: Record<string, unknown>;
      last_submission_id: string | null;
    }>(
      `SELECT id, status, filing_data, last_submission_id
       FROM filings
       WHERE id = $1 AND tenant_id = $2`,
      [filingId, req.user.tenantId]
    );

    const filing = filingResult.rows[0];
    if (!filing) {
      res.status(404).json({ error: 'Filing not found' });
      return;
    }

    if (
      filing.status !== FilingStatus.SUBMITTED &&
      filing.status !== FilingStatus.ACCEPTED
    ) {
      throw new ValidationError('Only submitted filings can be amended');
    }

    const updatedData = {
      ...(filing.filing_data || {}),
      ...(adjustments as Record<string, unknown>),
    };

    await db.query(
      `UPDATE filings
       SET filing_data = $1::jsonb,
           status = $2,
           updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4`,
      [
        JSON.stringify(updatedData),
        FilingStatus.DRAFT,
        filingId,
        req.user.tenantId,
      ]
    );

    const draftId = await createAmendmentDraft({
      filingId,
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      adjustments,
      reason,
      parentSubmissionId: filing.last_submission_id,
    });

    res.json({
      message: 'Amendment draft created',
      draftSubmissionId: draftId,
      filingData: updatedData,
    });
  } catch (error) {
    logger.error('Create amendment draft failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create amendment draft' });
  }
});

router.get('/:filingId/submissions', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filingId } = req.params;
    const submissions = await listFilingSubmissions(
      req.user.tenantId,
      filingId
    );

    res.json({ submissions });
  } catch (error) {
    logger.error('List filing submissions failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to fetch submission history' });
  }
});

// Create filing review
router.post('/:filingId/review', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filingId } = req.params;

    const reviewId = await createFilingReview(filingId, req.user.tenantId, req.user.userId);

    res.status(201).json({ reviewId, message: 'Filing review created' });
  } catch (error) {
    logger.error('Create filing review failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to create filing review' });
  }
});

// Get filing review checklist
router.get('/:filingId/review/checklist', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filingId } = req.params;

    const checklist = await getFilingReviewChecklist(filingId, req.user.tenantId);

    res.json({ checklist });
  } catch (error) {
    logger.error('Get filing review checklist failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get filing review checklist' });
  }
});

// Approve filing review
router.post('/:filingId/review/approve', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filingId } = req.params;
    const { reviewId, notes } = req.body;

    if (!reviewId) {
      throw new ValidationError('reviewId is required');
    }

    await approveFilingReview(reviewId, req.user.userId, notes);

    res.json({ message: 'Filing review approved' });
  } catch (error) {
    logger.error('Approve filing review failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to approve filing review' });
  }
});

// Reject filing review
router.post('/:filingId/review/reject', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filingId } = req.params;
    const { reviewId, reason } = req.body;

    if (!reviewId || !reason) {
      throw new ValidationError('reviewId and reason are required');
    }

    await rejectFilingReview(reviewId, req.user.userId, reason);

    res.json({ message: 'Filing review rejected' });
  } catch (error) {
    logger.error('Reject filing review failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to reject filing review' });
  }
});

export { router as filingRouter };
