import { Router, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { uploadFile, initializeBucket } from '../storage/s3';
import { publishOCRJob, publishClassificationJob, publishLedgerJob } from '../messaging/queue';
import { DocumentStatus, DocumentType, DocumentUploadSource } from '@ai-accountant/shared-types';
import { AuthRequest } from '../middleware/auth';
import { ValidationError } from '@ai-accountant/shared-utils';
import { assessDocumentQuality } from '../services/qualityAssessment';
import { guidanceService } from '../services/guidanceService';
import {
  DocumentProcessingStage,
  getDocumentStageHistory,
  getStageForStatus,
  recordDocumentStageTransition,
} from '../services/documentWorkflow';

const router = Router();
const logger = createLogger('document-ingest-service');

const UPLOAD_SOURCES: DocumentUploadSource[] = ['dashboard', 'onboarding', 'mobile', 'api', 'legacy'];

function parseDocumentTypeInput(value?: string): DocumentType | undefined {
  if (!value) {
    return undefined;
  }
  const match = Object.values(DocumentType).find(type => type === value);
  return match;
}

function parseUploadSource(value?: string): DocumentUploadSource {
  if (!value) {
    return 'dashboard';
  }
  return (UPLOAD_SOURCES.includes(value as DocumentUploadSource) ? value : 'dashboard') as DocumentUploadSource;
}

function sanitizeNotes(value?: string): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 2000);
}

function getTraceId(req: AuthRequest): string | undefined {
  const header = req.headers['x-request-id'];
  if (Array.isArray(header)) {
    return header[0];
  }
  if (typeof header === 'string') {
    return header;
  }
  return undefined;
}

function determineRetryStage(
  status: DocumentStatus,
  extractedData: Record<string, unknown> | null
): DocumentProcessingStage {
  if (status === DocumentStatus.UPLOADED || status === DocumentStatus.PROCESSING) {
    return 'ocr';
  }

  if (status === DocumentStatus.EXTRACTED) {
    return 'classification';
  }

  if (status === DocumentStatus.CLASSIFIED) {
    return 'ledger_posting';
  }

  if (status === DocumentStatus.ERROR) {
    if (extractedData?.['rawText']) {
      return extractedData?.['classification'] ? 'ledger_posting' : 'classification';
    }
    return 'ocr';
  }

  throw new ValidationError('Document is not eligible for retry');
}

// Initialize storage on startup (skip during tests)
if (process.env.NODE_ENV !== 'test') {
  initializeBucket().catch((err) => {
    logger.error('Failed to initialize storage', err);
  });
}

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/pdf', 'application/pdf', 'text/csv'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: JPEG, PNG, PDF, CSV'));
    }
  },
});

// Upload document
router.post('/upload', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!req.file) {
      throw new ValidationError('No file provided');
    }

    const { file } = req;
    const traceId = getTraceId(req);
    const documentId = randomUUID();
    const storageKey = `${req.user.tenantId}/${documentId}/${file.originalname}`;
    const declaredType = parseDocumentTypeInput(req.body?.documentType);
    const uploadSource = parseUploadSource(req.body?.source);
    const notes = sanitizeNotes(req.body?.notes);
    const quality = await assessDocumentQuality(file, declaredType);

    // Upload to S3
    await uploadFile(storageKey, file.buffer, file.mimetype);

    // Save document record
    const result = await db.query(
      `INSERT INTO documents (
        id, tenant_id, uploaded_by, file_name, file_type, file_size,
        storage_key, status, document_type, quality_score, quality_issues,
        upload_checklist, page_count, upload_source, upload_notes, suggested_document_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16)
      RETURNING id, file_name, file_type, file_size, status, created_at,
                document_type, quality_score, quality_issues, upload_checklist,
                page_count, upload_source, upload_notes, suggested_document_type`,
      [
        documentId,
        req.user.tenantId,
        req.user.userId,
        file.originalname,
        file.mimetype,
        file.size,
        storageKey,
        DocumentStatus.UPLOADED,
        declaredType || null,
        quality.score,
        JSON.stringify(quality.issues),
        JSON.stringify(quality.checklist),
        quality.pageCount,
        uploadSource,
        notes,
        quality.suggestedType,
      ]
    );

    const document = result.rows[0];
    if (!document) {
      res.status(500).json({ error: 'Failed to create document record' });
      return;
    }

      await recordDocumentStageTransition({
        documentId,
        tenantId: req.user.tenantId,
        toStatus: DocumentStatus.UPLOADED,
        trigger: 'upload',
        metadata: {
          source: uploadSource,
          traceId,
        },
        updateDocumentStatus: false,
      });

    // Publish OCR job
    try {
      await publishOCRJob(documentId, storageKey, {
        tenantId: req.user.tenantId,
        traceId,
        headers: {
          'x-trigger': 'upload',
        },
      });
        await recordDocumentStageTransition({
          documentId,
          tenantId: req.user.tenantId,
          toStatus: DocumentStatus.PROCESSING,
          trigger: 'ocr_enqueued',
          metadata: { traceId, source: uploadSource },
        });
    } catch (error) {
      logger.error('Failed to publish OCR job', error instanceof Error ? error : new Error(String(error)));
      // Continue anyway - job can be retried
    }

    logger.info('Document uploaded', { documentId, tenantId: req.user.tenantId });

    // Evaluate and attach guidance (async, don't block response)
    guidanceService.evaluateGuidance(documentId).catch((err) => {
      logger.warn('Failed to evaluate guidance', { documentId, error: err instanceof Error ? err.message : String(err) });
    });

    res.status(201).json({
      document: {
        id: document.id,
        fileName: document.file_name,
        fileType: document.file_type,
        fileSize: document.file_size,
        status: document.status,
        documentType: document.document_type,
        createdAt: document.created_at,
        qualityScore: document.quality_score,
        qualityIssues: document.quality_issues,
        uploadChecklist: document.upload_checklist,
        pageCount: document.page_count,
        uploadSource: document.upload_source,
        uploadNotes: document.upload_notes,
        suggestedDocumentType: document.suggested_document_type,
      },
      guidance: quality,
    });
  } catch (error) {
    logger.error('Upload failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Get documents
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const page = parseInt(String(req.query.page || '1'), 10);
    const limit = parseInt(String(req.query.limit || '20'), 10);
    const offset = (page - 1) * limit;

      const result = await db.query<{
        id: string;
        file_name: string;
        file_type: string;
        file_size: number;
        document_type: string | null;
        status: string;
        confidence_score: number | null;
        quality_score: number | null;
        quality_issues: unknown;
        upload_checklist: unknown;
        page_count: number | null;
        upload_source: string | null;
        suggested_document_type: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, file_name, file_type, file_size, document_type, status, processing_stage,
                confidence_score, quality_score, quality_issues, upload_checklist,
                page_count, upload_source, suggested_document_type,
                created_at, updated_at
       FROM documents
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.tenantId, limit, offset]
    );

    const countResult = await db.query<{
      total: string | number;
    }>(
      'SELECT COUNT(*) as total FROM documents WHERE tenant_id = $1',
      [req.user.tenantId]
    );

    const totalRow = countResult.rows[0];
    const total = totalRow ? (typeof totalRow.total === 'number' ? totalRow.total : parseInt(String(totalRow.total || '0'), 10)) : 0;
    
      const documents = result.rows.map(row => ({
        ...row,
        processing_stage: row.processing_stage || getStageForStatus(row.status),
      }));

      res.json({
        documents,
      pagination: {
        page,
        limit,
        total,
      },
    });
  } catch (error) {
    logger.error('Get documents failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get documents' });
  }
});

router.get('/status/jobs', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = parseInt(String(req.query.limit || '10'), 10);
  const result = await db.query<{
    id: string;
    file_name: string;
    status: DocumentStatus;
    processing_stage: DocumentProcessingStage | null;
    confidence_score: number | null;
    error_message: string | null;
    updated_at: Date;
  }>(
    `SELECT id, file_name, status, processing_stage, confidence_score, error_message, updated_at
         FROM documents
         WHERE tenant_id = $1
         ORDER BY updated_at DESC
         LIMIT $2`,
    [req.user.tenantId, Number.isNaN(limit) ? 10 : limit]
  );

  const jobs = result.rows.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    status: row.status,
    stage: row.processing_stage || getStageForStatus(row.status),
    confidenceScore: row.confidence_score,
    errorMessage: row.error_message,
    updatedAt: row.updated_at,
  }));

    res.json({ jobs });
  } catch (error) {
    logger.error('Get processing status failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to fetch processing status' });
  }
});

// Get document by ID
router.get('/:documentId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;

    const result = await db.query(
        `SELECT id, file_name, file_type, file_size, document_type, status,
              extracted_data, confidence_score, error_message, quality_score,
              quality_issues, upload_checklist, page_count, upload_source,
                upload_notes, suggested_document_type, processing_stage,
              created_at, updated_at
       FROM documents
       WHERE id = $1 AND tenant_id = $2`,
      [documentId, req.user.tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

      const doc = result.rows[0];
      res.json({
        document: {
          ...doc,
          processing_stage: doc.processing_stage || getStageForStatus(doc.status),
        },
      });
  } catch (error) {
    logger.error('Get document failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get document' });
  }
});

// Get document stage timeline
router.get('/:documentId/stages', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    const history = await getDocumentStageHistory(documentId, req.user.tenantId);
    res.json({ history });
  } catch (error) {
    logger.error('Get document stages failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to fetch document stages' });
  }
});

// Get review queue
router.get('/review/queue', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { limit } = req.query;
      const { getReviewQueue } = await import('../services/documentReview');

    const queue = await getReviewQueue(req.user.tenantId, limit ? parseInt(String(limit), 10) : 50);
    res.json({ queue });
  } catch (error) {
    logger.error('Get review queue failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get review queue' });
  }
});

// Get document audit log
router.get('/:documentId/audit-log', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    const { limit } = req.query;
    const { getDocumentAuditLog } = await import('../services/documentReview');

    const auditLog = await getDocumentAuditLog(
      documentId,
      req.user.tenantId,
      limit ? parseInt(String(limit), 10) : 25
    );

    res.json({ auditLog });
  } catch (error) {
    logger.error('Get document audit log failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get audit log' });
  }
});

// Update extracted data
router.put('/:documentId/extracted-data', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    const { extractedData } = req.body;

    if (!extractedData) {
      throw new ValidationError('extractedData is required');
    }

      const { updateExtractedData } = await import('../services/documentReview');

      await updateExtractedData(documentId, req.user.tenantId, req.user.userId, extractedData);

    res.json({ message: 'Extracted data updated' });
  } catch (error) {
    logger.error('Update extracted data failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to update extracted data' });
  }
});

// Approve document
router.post('/:documentId/approve', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
      const { approveDocument } = await import('../services/documentReview');

      await approveDocument(documentId, req.user.tenantId, req.user.userId);

    res.json({ message: 'Document approved' });
  } catch (error) {
    logger.error('Approve document failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to approve document' });
  }
});

// Reject document
router.post('/:documentId/reject', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      throw new ValidationError('reason is required');
    }

      const { rejectDocument } = await import('../services/documentReview');

      await rejectDocument(documentId, req.user.tenantId, req.user.userId, reason);

    res.json({ message: 'Document rejected' });
  } catch (error) {
    logger.error('Reject document failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to reject document' });
  }
});

// Retry document processing
router.post('/:documentId/retry', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;

    const docResult = await db.query<{
      id: string;
      status: DocumentStatus;
      storage_key: string;
      extracted_data: Record<string, unknown> | null;
      document_type: string | null;
    }>(
      `SELECT id, status, storage_key, extracted_data, document_type
       FROM documents
       WHERE id = $1 AND tenant_id = $2`,
      [documentId, req.user.tenantId]
    );

    if (docResult.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const document = docResult.rows[0];
    const extractedData = document.extracted_data || null;
    const traceId = getTraceId(req);
    const targetStage = determineRetryStage(document.status, extractedData);
    const retryHeaders = { 'x-trigger': 'retry' as const };

    if (targetStage === 'ocr') {
      if (!document.storage_key) {
        throw new ValidationError('Document storage key missing; re-upload required');
      }
        await publishOCRJob(documentId, document.storage_key, {
          tenantId: req.user.tenantId,
          traceId,
          headers: retryHeaders,
        });
        await recordDocumentStageTransition({
          documentId,
          tenantId: req.user.tenantId,
          toStatus: DocumentStatus.PROCESSING,
          trigger: 'retry_ocr',
          metadata: { userId: req.user.userId, traceId },
        });
    } else if (targetStage === 'classification') {
      const rawText = extractedData?.['rawText'];
      if (typeof rawText !== 'string' || rawText.length === 0) {
        throw new ValidationError('No extracted text available for classification retry');
      }
      await publishClassificationJob(documentId, rawText, {
        tenantId: req.user.tenantId,
        traceId,
        headers: retryHeaders,
      });
        await recordDocumentStageTransition({
          documentId,
          tenantId: req.user.tenantId,
          toStatus: DocumentStatus.EXTRACTED,
          trigger: 'retry_classification',
          metadata: { userId: req.user.userId, traceId },
        });
    } else if (targetStage === 'ledger_posting') {
      await publishLedgerJob(
        documentId,
        { reason: 'manual_retry' },
        {
          tenantId: req.user.tenantId,
          traceId,
          headers: retryHeaders,
        }
      );
        await recordDocumentStageTransition({
          documentId,
          tenantId: req.user.tenantId,
          toStatus: DocumentStatus.CLASSIFIED,
          trigger: 'retry_posting',
          metadata: { userId: req.user.userId, traceId },
        });
    } else {
      throw new ValidationError('Document is not eligible for retry');
    }

    res.json({ message: `Document re-queued for ${targetStage.replace('_', ' ')}` });
  } catch (error) {
    logger.error('Retry document failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to retry document' });
  }
});

// Detect duplicates
router.get('/:documentId/duplicates', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    const { detectDuplicates } = await import('../services/duplicateDetection');

    const duplicates = await detectDuplicates(req.user.tenantId, documentId);
    res.json({ duplicates });
  } catch (error) {
    logger.error('Detect duplicates failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to detect duplicates' });
  }
});

export { router as documentRouter };
