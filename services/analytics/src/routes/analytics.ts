import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { predictRevenue, detectTrends } from '../services/predictive';
import { ValidationError } from '@ai-accountant/shared-utils';
import { getDashboardStats } from '../services/dashboard';
import { runScenarioAnalysis } from '../services/scenarioPlanner';
import { getExecutiveInsights } from '../services/insights';

const router = Router();
const logger = createLogger('analytics-service');

// Predict revenue
router.post('/predict/revenue', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { months } = req.body;
    const prediction = await predictRevenue(req.user.tenantId, months || 6);

    res.json({ prediction });
  } catch (error) {
    logger.error('Predict revenue failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to predict revenue' });
  }
});

// Detect trends
router.get('/trends', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const trends = await detectTrends(req.user.tenantId);
    res.json({ trends });
  } catch (error) {
    logger.error('Detect trends failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to detect trends' });
  }
});

// Dashboard stats
router.get('/dashboard', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate } = req.query;

    const stats = await getDashboardStats(req.user.tenantId, {
      periodStart: startDate ? new Date(String(startDate)) : undefined,
      periodEnd: endDate ? new Date(String(endDate)) : undefined,
    });

    res.json({ stats });
  } catch (error) {
    logger.error('Get dashboard stats failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to generate dashboard stats' });
  }
});

router.post('/scenarios', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await runScenarioAnalysis(req.user.tenantId, req.body ?? {});
    res.json({ scenario: result });
  } catch (error) {
    logger.error('Scenario planning failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to run scenario analysis' });
  }
});

router.get('/insights', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const insights = await getExecutiveInsights(req.user.tenantId);
    res.json({ insights });
  } catch (error) {
    logger.error('Get insights failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to load executive insights' });
  }
});

export { router as analyticsRouter };
