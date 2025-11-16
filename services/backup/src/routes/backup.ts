import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { backupRestoreService } from '../services/backupRestore';
import { UserRole } from '@ai-accountant/shared-types';
import { AuthorizationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('backup-service');

// Backup Routes
router.post('/backups', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can start backups');
    }

    const { backupType, serviceName, tenantId, backupEncrypted, metadata } = req.body;
    const backup = await backupRestoreService.startBackup(backupType, serviceName, {
      tenantId,
      backupEncrypted,
      metadata,
    });

    res.status(201).json(backup);
  } catch (error) {
    logger.error('Error starting backup', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.patch('/backups/:id/complete', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can complete backups');
    }

    const { backupSizeBytes, backupLocation, retentionUntil } = req.body;
    const backup = await backupRestoreService.completeBackup(req.params.id, {
      backupSizeBytes,
      backupLocation,
      retentionUntil: retentionUntil ? new Date(retentionUntil) : undefined,
    });

    res.json(backup);
  } catch (error) {
    logger.error('Error completing backup', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.patch('/backups/:id/fail', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can fail backups');
    }

    const { errorMessage } = req.body;
    const backup = await backupRestoreService.failBackup(req.params.id, errorMessage);
    res.json(backup);
  } catch (error) {
    logger.error('Error failing backup', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/backups', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { serviceName, tenantId, backupStatus, page, limit } = req.query;
    const { logs, total } = await backupRestoreService.getBackupLogs({
      serviceName: serviceName as string | undefined,
      tenantId: tenantId as string | undefined,
      backupStatus: backupStatus as 'in_progress' | 'completed' | 'failed' | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : undefined,
    });

    res.json({ logs, total, page: page ? parseInt(page as string, 10) : 1, limit: limit ? parseInt(limit as string, 10) : 100 });
  } catch (error) {
    logger.error('Error getting backup logs', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/backups/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const backup = await backupRestoreService.getBackupLog(req.params.id);
    res.json(backup);
  } catch (error) {
    logger.error('Error getting backup log', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

// Restore Routes
router.post('/backups/:id/restore', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can request restores');
    }

    const { restoreToPoint, restoreStatus } = req.body;
    const restore = await backupRestoreService.requestRestore(req.params.id, new Date(restoreToPoint), req.user.userId, {
      restoreStatus,
    });

    res.status(201).json(restore);
  } catch (error) {
    logger.error('Error requesting restore', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.patch('/backups/:id/restore/complete', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can complete restores');
    }

    const { restoreStatus, verificationStatus, verificationNotes } = req.body;
    const restore = await backupRestoreService.completeRestore(req.params.id, {
      restoreStatus,
      verificationStatus,
      verificationNotes,
    });

    res.json(restore);
  } catch (error) {
    logger.error('Error completing restore', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

export { router as backupRouter };
