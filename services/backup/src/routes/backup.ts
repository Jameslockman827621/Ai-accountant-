import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  createBackup,
  getBackup,
  getBackups,
  downloadBackup,
  exportTenantData,
} from '../services/backup';
import { automatedBackupService } from '../services/automatedBackup';
import { exportUserData, getExportStatus, getExports } from '../services/dataExport';
import { restoreFromBackup, getRestoreStatus, getRestoreHistory } from '../services/restore';

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

// Export user data (GDPR)
router.post('/export', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { format } = req.body;
    const exportId = await exportUserData(req.user.tenantId, format || 'json');

    res.status(202).json({ exportId, message: 'Data export started' });
  } catch (error) {
    logger.error('Export user data failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to start data export' });
  }
});

// Get export status
router.get('/exports/:exportId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { exportId } = req.params;
    const exportStatus = await getExportStatus(exportId, req.user.tenantId);

    if (!exportStatus) {
      res.status(404).json({ error: 'Export not found' });
      return;
    }

    res.json({ export: exportStatus });
  } catch (error) {
    logger.error('Get export status failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get export status' });
  }
});

// Get all exports
router.get('/exports', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const exports = await getExports(req.user.tenantId);
    res.json({ exports });
  } catch (error) {
    logger.error('Get exports failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get exports' });
  }
});

// Restore from backup
router.post('/restore', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { backupId, restoreType, restorePoint } = req.body;

    if (!backupId) {
      throw new ValidationError('backupId is required');
    }

    const restoreId = await restoreFromBackup(
      req.user.tenantId,
      backupId,
      restoreType || 'full',
      restorePoint ? new Date(restorePoint) : undefined
    );

    res.status(202).json({ restoreId, message: 'Restore operation started' });
  } catch (error) {
    logger.error('Restore from backup failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to start restore operation' });
  }
});

// Get restore status
router.get('/restores/:restoreId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { restoreId } = req.params;
    const restoreStatus = await getRestoreStatus(restoreId, req.user.tenantId);

    if (!restoreStatus) {
      res.status(404).json({ error: 'Restore operation not found' });
      return;
    }

    res.json({ restore: restoreStatus });
  } catch (error) {
    logger.error('Get restore status failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get restore status' });
  }
});

// Get restore history
router.get('/restores', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const history = await getRestoreHistory(req.user.tenantId);
    res.json({ history });
  } catch (error) {
    logger.error('Get restore history failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get restore history' });
  }
});

export { router as backupRouter };
