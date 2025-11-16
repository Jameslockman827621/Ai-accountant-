import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { deleteUserData, exportUserData } from '../services/gdpr';
import { getAuditLogs } from '../services/audit';
import { complianceCalendarService } from '../services/complianceCalendar';
import { UserRole } from '@ai-accountant/shared-types';
import { AuthorizationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('compliance-service');

// Get audit logs
router.get('/audit-logs', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Only admins and accountants can view audit logs
    if (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const {
      userId,
      resourceType,
      resourceId,
      startDate,
      endDate,
      page,
      limit,
    } = req.query;

    const filters: {
      userId?: string;
      resourceType?: string;
      resourceId?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    } = {
      limit: limit ? parseInt(limit as string, 10) : 100,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : 0,
    };

    if (userId) {
      filters.userId = userId as string;
    }
    if (resourceType) {
      filters.resourceType = resourceType as string;
    }
    if (resourceId) {
      filters.resourceId = resourceId as string;
    }
    if (startDate) {
      filters.startDate = new Date(startDate as string);
    }
    if (endDate) {
      filters.endDate = new Date(endDate as string);
    }

    const result = await getAuditLogs(req.user.tenantId, filters);

    res.json(result);
  } catch (error) {
    logger.error('Get audit logs failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof AuthorizationError) {
      res.status(403).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to get audit logs' });
  }
});

// Export user data (GDPR)
router.get('/export-data', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const data = await exportUserData(req.user.tenantId, req.user.userId);

    res.json({ data });
  } catch (error) {
    logger.error('Export data failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Delete user data (GDPR right to erasure)
router.delete('/delete-data', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await deleteUserData(req.user.tenantId, req.user.userId);

    res.json({ message: 'User data deleted successfully' });
  } catch (error) {
    logger.error('Delete data failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to delete data' });
  }
});

// Get compliance calendar
router.get('/calendar', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate } = req.query;
    const start = startDate ? (startDate as string) : new Date().toISOString().split('T')[0];
    const end = endDate ? (endDate as string) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const calendar = await complianceCalendarService.generateCalendar(
      req.user.tenantId,
      start,
      end
    );

    res.json({ calendar });
  } catch (error) {
    logger.error('Get compliance calendar failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get compliance calendar' });
  }
});

// Get upcoming deadlines
router.get('/deadlines', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
    const deadlines = await complianceCalendarService.getUpcomingDeadlines(
      req.user.tenantId,
      days
    );

    res.json({ deadlines });
  } catch (error) {
    logger.error('Get deadlines failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get deadlines' });
  }
});

// Update readiness scores
router.post('/readiness/update', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await complianceCalendarService.updateReadinessScores(req.user.tenantId);
    res.json({ message: 'Readiness scores updated' });
  } catch (error) {
    logger.error('Update readiness failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to update readiness scores' });
  }
});

export { router as complianceRouter };
