import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { predictRevenue, detectTrends } from '../services/predictive';
import { getDashboardStats } from '../services/dashboard';
import { runScenarioAnalysis } from '../services/scenarioPlanner';
import { getExecutiveInsights } from '../services/insights';
import { runCashflowPipeline } from '../services/cashflowPipeline';
import { buildForecastingPortfolio } from '../services/forecastingModels';

const router = Router();
const logger = createLogger('analytics-service');

const ensureUser = (req: AuthRequest, res: Response): AuthRequest['user'] | null => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  return req.user;
};

// Predict revenue
router.post('/predict/revenue', async (req: AuthRequest, res: Response) => {
  try {
    const user = ensureUser(req, res);
    if (!user) return;

    const { months } = req.body;
    const prediction = await predictRevenue(user.tenantId, months || 6);

    res.json({ prediction });
  } catch (error) {
    logger.error('Predict revenue failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to predict revenue' });
  }
});

// Detect trends
router.get('/trends', async (req: AuthRequest, res: Response) => {
  try {
    const user = ensureUser(req, res);
    if (!user) return;

    const trends = await detectTrends(user.tenantId);
    res.json({ trends });
  } catch (error) {
    logger.error('Detect trends failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to detect trends' });
  }
});

// Dashboard stats
router.get('/dashboard', async (req: AuthRequest, res: Response) => {
  try {
    const user = ensureUser(req, res);
    if (!user) return;

    const { startDate, endDate } = req.query;

    const options: Parameters<typeof getDashboardStats>[1] = {};
    if (startDate) {
      options.periodStart = new Date(String(startDate));
    }
    if (endDate) {
      options.periodEnd = new Date(String(endDate));
    }

    const stats = await getDashboardStats(user.tenantId, options);

    res.json({ stats });
  } catch (error) {
    logger.error('Get dashboard stats failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to generate dashboard stats' });
  }
});

router.post('/scenarios', async (req: AuthRequest, res: Response) => {
  try {
    const user = ensureUser(req, res);
    if (!user) return;

    const result = await runScenarioAnalysis(user.tenantId, req.body ?? {});
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
    const user = ensureUser(req, res);
    if (!user) return;
    const insights = await getExecutiveInsights(user.tenantId);
    res.json({ insights });
  } catch (error) {
    logger.error('Get insights failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to load executive insights' });
  }
});

router.post('/cashflow/pipeline', async (req: AuthRequest, res: Response) => {
  try {
    const user = ensureUser(req, res);
    if (!user) return;

    const { horizonMonths, sensitivity } = req.body || {};
    const result = await runCashflowPipeline(user.tenantId, {
      horizonMonths,
      sensitivity,
    });

    res.json(result);
  } catch (error) {
    logger.error('Run cashflow pipeline failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to run cashflow pipeline' });
  }
});

router.get('/forecasting/models', async (req: AuthRequest, res: Response) => {
  try {
    const user = ensureUser(req, res);
    if (!user) return;

    const periods = Number(req.query.periods) || 6;
    const portfolio = await buildForecastingPortfolio(user.tenantId, periods);

    res.json({ portfolio });
  } catch (error) {
    logger.error('Load forecasting models failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to load forecasting models' });
  }
});

export { router as analyticsRouter };
