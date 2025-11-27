import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { sloTrackingService } from '../services/sloTracking';
import { UserRole } from '@ai-accountant/shared-types';
import { AuthorizationError } from '@ai-accountant/shared-utils';
import { AlertingService } from '../services/alertingService';

const router = Router();
const logger = createLogger('monitoring-service');
const alertingService = new AlertingService();

// SLO Tracking Routes
router.post('/slos', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can record SLOs');
    }

    const { serviceName, sloName, sloType, targetPercentage, measurementWindowHours, currentPercentage, errorBudgetTotal, errorBudgetConsumed, errorBudgetRemaining, errorBudgetBurnRate, periodStart, periodEnd, metadata } = req.body;
    const slo = await sloTrackingService.recordSLO(serviceName, sloName, sloType, targetPercentage, measurementWindowHours, {
      currentPercentage,
      errorBudgetTotal,
      errorBudgetConsumed,
      errorBudgetRemaining,
      errorBudgetBurnRate,
      periodStart: periodStart ? new Date(periodStart) : undefined,
      periodEnd: periodEnd ? new Date(periodEnd) : undefined,
      metadata,
    });

    res.status(201).json(slo);
  } catch (error) {
    logger.error('Error recording SLO', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/slos', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { serviceName, sloType, status, page, limit } = req.query;
    const { slos, total } = await sloTrackingService.getSLOs({
      serviceName: serviceName as string | undefined,
      sloType: sloType as 'availability' | 'latency' | 'error_rate' | 'freshness' | undefined,
      status: status as 'on_track' | 'at_risk' | 'breached' | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : undefined,
    });

    res.json({ slos, total, page: page ? parseInt(page as string, 10) : 1, limit: limit ? parseInt(limit as string, 10) : 100 });
  } catch (error) {
    logger.error('Error getting SLOs', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/slos/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const slo = await sloTrackingService.getSLO(req.params.id);
    res.json(slo);
  } catch (error) {
    logger.error('Error getting SLO', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

// Active incidents + recovery runbooks
router.get('/incidents/active', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const incidents = await alertingService.getActiveIncidents();
    res.json({ incidents });
  } catch (error) {
    logger.error('Error getting active incidents', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

export { router as monitoringRouter };
