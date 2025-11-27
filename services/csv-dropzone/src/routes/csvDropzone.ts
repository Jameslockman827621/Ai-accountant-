import { Router, Response } from 'express';
import multer from 'multer';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { ValidationError } from '@ai-accountant/shared-utils';
import { SchemaDetectionService } from '../services/schemaDetection';
import { unifiedIngestionService } from '../../ingestion/src/services/unifiedIngestion';
import { importTransactionsFromCSV } from '../../bank-feed/src/services/csvImport';

const router = Router();
const logger = createLogger('csv-dropzone-service');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Detect schema from uploaded file
router.post('/detect-schema', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!req.file) {
      throw new ValidationError('File is required');
    }

    const schemaService = new SchemaDetectionService();
    const schema = await schemaService.detectSchema(req.file.buffer, req.file.originalname);
    const suggestions = await schemaService.suggestMappings(schema);

    res.json({
      schema: {
        ...schema,
        suggestedMappings: suggestions.reduce((acc, s) => {
          acc[s.sourceColumn] = s.targetField;
          return acc;
        }, {} as Record<string, string>),
      },
    });
  } catch (error) {
    logger.error('Schema detection failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to detect schema' });
  }
});

// Upload and import CSV/Excel file
router.post('/upload', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!req.file) {
      throw new ValidationError('File is required');
    }

    const { mappings, schema } = req.body;
    if (!mappings || !schema) {
      throw new ValidationError('Mappings and schema are required');
    }

    const parsedMappings = typeof mappings === 'string' ? JSON.parse(mappings) : mappings;
    const parsedSchema = typeof schema === 'string' ? JSON.parse(schema) : schema;

    // Process file with mappings
    const schemaService = new SchemaDetectionService();
    const records = await schemaService.parseWithMappings(
      req.file.buffer,
      req.file.originalname,
      parsedMappings,
      parsedSchema
    );

    // Log ingestion for each record
    const ingestionLogIds = [];
    for (const record of records) {
      const logId = await unifiedIngestionService.logIngestion(
        req.user.tenantId,
        req.user.userId,
        {
          sourceType: 'csv_import',
          payload: record,
          metadata: {
            fileName: req.file.originalname,
            mappings: parsedMappings,
          },
        }
      );
      ingestionLogIds.push(logId);
    }

    res.json({
      message: 'File uploaded and processed successfully',
      recordsProcessed: records.length,
      ingestionLogIds,
    });
  } catch (error) {
    logger.error('File upload failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Fallback CSV import that posts straight into bank feed when APIs are unavailable
router.post('/fallback-import', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!req.file) {
      throw new ValidationError('File is required');
    }

    const { accountId, dateFormat, delimiter } = req.body ?? {};
    if (!accountId) {
      throw new ValidationError('accountId is required to import transactions');
    }

    const result = await importTransactionsFromCSV(
      req.user.tenantId,
      req.user.userId,
      req.file.buffer.toString('utf-8'),
      accountId,
      {
        dateFormat: dateFormat || undefined,
        delimiter: delimiter || undefined,
        skipHeader: true,
      }
    );

    res.json({
      message: 'CSV fallback import completed',
      result,
    });
  } catch (error) {
    logger.error('CSV fallback import failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to import CSV via fallback' });
  }
});

export { router as csvDropzoneRouter };
