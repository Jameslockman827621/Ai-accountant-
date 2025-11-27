import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { chaosTestService } from '../services/chaosTests';
import { UserRole } from '@ai-accountant/shared-types';
import { AuthorizationError } from '@ai-accountant/shared-utils';
import { executeGatewayLoad } from '../services/loadHarness';

const router = Router();
const logger = createLogger('chaos-service');

// Chaos Test Routes
router.post('/tests', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can start chaos tests');
    }

    const { testName, testType, affectedServices, affectedTenants, environment, metadata } = req.body;
    const test = await chaosTestService.startTest(testName, testType, {
      affectedServices,
      affectedTenants,
      environment,
      runBy: req.user.userId,
      metadata,
    });

    res.status(201).json(test);
  } catch (error) {
    logger.error('Error starting chaos test', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.patch('/tests/:id/complete', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can complete chaos tests');
    }

    const { status, errorRateBefore, errorRateDuring, errorRateAfter, recoveryTimeSeconds, testPassed, failurePoints, recoveryActions, lessonsLearned } = req.body;
    const test = await chaosTestService.completeTest(req.params.id, status, {
      errorRateBefore,
      errorRateDuring,
      errorRateAfter,
      recoveryTimeSeconds,
      testPassed,
      failurePoints,
      recoveryActions,
      lessonsLearned,
    });

    res.json(test);
  } catch (error) {
    logger.error('Error completing chaos test', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/tests', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { testType, status, testPassed, environment, page, limit } = req.query;
    const { results, total } = await chaosTestService.getTestResults({
      testType: testType as 'connector_outage' | 'queue_delay' | 'db_failover' | 'service_degradation' | 'other' | undefined,
      status: status as 'running' | 'completed' | 'failed' | 'cancelled' | undefined,
      testPassed: testPassed !== undefined ? testPassed === 'true' : undefined,
      environment: environment as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : undefined,
    });

    res.json({ results, total, page: page ? parseInt(page as string, 10) : 1, limit: limit ? parseInt(limit as string, 10) : 100 });
  } catch (error) {
    logger.error('Error getting chaos test results', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/tests/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const test = await chaosTestService.getTestResult(req.params.id);
    res.json(test);
  } catch (error) {
    logger.error('Error getting chaos test result', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.post('/load-tests/gateway', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can run gateway load tests');
    }

    const targetUrl = req.body?.targetUrl || 'http://localhost:3000/health';
    const result = await executeGatewayLoad(targetUrl);
    res.json(result);
  } catch (error) {
    logger.error('Error running gateway load test', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

export { router as chaosRouter };
