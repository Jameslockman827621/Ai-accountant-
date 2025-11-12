import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  createBackup,
  getBackup,
  getBackups,
  downloadBackup,
  exportTenantData,
} from '../services/backup';

const router = Router();
const logger = createLogger('backup-service');

// Create backup
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { backupType } = req.body;

    const backupId = await createBackup(req.user.tenantId, backupType || 'manual');

    res.status(201).json({ backupId, message: 'Backup created' });
  } catch (error) {
    logger.error('Create backup failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

// Get backups
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const backups = await getBackups(req.user.tenantId);
    res.json({ backups });
  } catch (error) {
    logger.error('Get backups failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get backups' });
  }
});

// Get backup by ID
router.get('/:backupId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { backupId } = req.params;

    const backup = await getBackup(backupId, req.user.tenantId);

    if (!backup) {
      res.status(404).json({ error: 'Backup not found' });
      return;
    }

    res.json({ backup });
  } catch (error) {
    logger.error('Get backup failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get backup' });
  }
});

// Download backup
router.get('/:backupId/download', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { backupId } = req.params;

    const fileBuffer = await downloadBackup(backupId, req.user.tenantId);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="backup-${backupId}.json"`);
    res.send(fileBuffer);
  } catch (error) {
    logger.error('Download backup failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to download backup' });
  }
});

// Export data (GDPR export)
router.get('/export/data', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const exportData = await exportTenantData(req.user.tenantId);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="data-export.json"');
    res.json(exportData);
  } catch (error) {
    logger.error('Export data failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to export data' });
  }
});

export { router as backupRouter };
