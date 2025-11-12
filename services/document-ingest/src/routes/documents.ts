import { Router, Request, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { uploadFile, initializeBucket } from '../storage/s3';
import { publishOCRJob } from '../messaging/queue';
import { DocumentStatus } from '@ai-accountant/shared-types';
import { AuthRequest } from '../middleware/auth';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('document-ingest-service');

// Initialize storage on startup
initializeBucket().catch((err) => {
  logger.error('Failed to initialize storage', err);
});

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
    const documentId = randomUUID();
    const storageKey = `${req.user.tenantId}/${documentId}/${file.originalname}`;

    // Upload to S3
    await uploadFile(storageKey, file.buffer, file.mimetype);

    // Save document record
    const result = await db.query(
      `INSERT INTO documents (
        id, tenant_id, uploaded_by, file_name, file_type, file_size,
        storage_key, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, file_name, file_type, file_size, status, created_at`,
      [
        documentId,
        req.user.tenantId,
        req.user.userId,
        file.originalname,
        file.mimetype,
        file.size,
        storageKey,
        DocumentStatus.UPLOADED,
      ]
    );

    const document = result.rows[0];

    // Publish OCR job
    try {
      await publishOCRJob(documentId, storageKey);
      await db.query(
        'UPDATE documents SET status = $1 WHERE id = $2',
        [DocumentStatus.PROCESSING, documentId]
      );
    } catch (error) {
      logger.error('Failed to publish OCR job', error instanceof Error ? error : new Error(String(error)));
      // Continue anyway - job can be retried
    }

    logger.info('Document uploaded', { documentId, tenantId: req.user.tenantId });

    res.status(201).json({
      document: {
        id: document.id,
        fileName: document.file_name,
        fileType: document.file_type,
        fileSize: document.file_size,
        status: document.status,
        createdAt: document.created_at,
      },
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

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const result = await db.query(
      `SELECT id, file_name, file_type, file_size, document_type, status,
              confidence_score, created_at, updated_at
       FROM documents
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.tenantId, limit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(*) as total FROM documents WHERE tenant_id = $1',
      [req.user.tenantId]
    );

    res.json({
      documents: result.rows,
      pagination: {
        page,
        limit,
        total: parseInt(countResult.rows[0]?.total || '0', 10),
      },
    });
  } catch (error) {
    logger.error('Get documents failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get documents' });
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
              extracted_data, confidence_score, error_message, created_at, updated_at
       FROM documents
       WHERE id = $1 AND tenant_id = $2`,
      [documentId, req.user.tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.json({ document: result.rows[0] });
  } catch (error) {
    logger.error('Get document failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get document' });
  }
});

export { router as documentRouter };
