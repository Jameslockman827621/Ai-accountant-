import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { sloTrackingService } from '../services/sloTracking';
import { disasterRecoveryService } from '../services/disasterRecovery';
import { UserRole } from '@ai-accountant/shared-types';
import { AuthorizationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('monitoring-service');

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

// Disaster recovery drill logging
router.post('/dr-simulations', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can record DR simulations');
    }

    const { backupId, simulationId, rtoSeconds, rpoMinutes, status, integrityVerified, notes } = req.body;
    const entry = await disasterRecoveryService.recordSimulation({
      backupId,
      simulationId,
      rtoSeconds,
      rpoMinutes,
      status,
      integrityVerified,
      notes,
    });

    res.status(201).json(entry);
  } catch (error) {
    logger.error('Error recording DR simulation', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/dr-simulations', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const logs = await disasterRecoveryService.listSimulations();
    res.json({ logs });
  } catch (error) {
    logger.error('Error retrieving DR simulations', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/dr-simulations/metrics', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const metrics = await disasterRecoveryService.getRpoRtoSnapshot();
    res.json(metrics);
  } catch (error) {
    logger.error('Error retrieving DR metrics', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

export { router as monitoringRouter };
