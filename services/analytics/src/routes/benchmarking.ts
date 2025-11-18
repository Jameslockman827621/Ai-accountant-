/**
 * Benchmarking API Routes
 */

import { Router } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { benchmarkingService } from '../services/benchmarking';

const logger = createLogger('benchmarking-routes');
const router = Router();

// Get benchmark comparison
router.get('/benchmark', async (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    const { industry, period = '2024', metrics } = req.query;

    if (!tenantId || !industry) {
      return res.status(400).json({ error: 'tenantId and industry are required' });
    }

    const metricList = metrics
      ? (metrics as string).split(',')
      : ['gross_margin', 'net_profit_margin'];

    const comparisons = await benchmarkingService.compareToBenchmark(
      tenantId,
      industry as string,
      metricList,
      period as string
    );

    return res.json({ comparisons });
  } catch (error) {
    logger.error('Failed to get benchmark comparison', error);
    return res.status(500).json({ error: 'Failed to get benchmark comparison' });
  }
});

// Get specific benchmark
router.get('/benchmark/:industry/:metric', async (req, res) => {
  try {
    const { industry, metric } = req.params;
    const { period = '2024' } = req.query;

    const benchmark = await benchmarkingService.getBenchmark(industry, metric, period as string);

    if (!benchmark) {
      return res.status(404).json({ error: 'Benchmark not found' });
    }

    return res.json({ benchmark });
  } catch (error) {
    logger.error('Failed to get benchmark', error);
    return res.status(500).json({ error: 'Failed to get benchmark' });
  }
});

// Update benchmark data (admin only)
router.post('/benchmark', async (req, res) => {
  try {
    const {
      industry,
      metric,
      period,
      value,
      percentile25,
      percentile50,
      percentile75,
      percentile90,
      source,
    } = req.body;

    if (!industry || !metric || !period || value === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await benchmarkingService.updateBenchmarkData({
      industry,
      metric,
      period,
      value,
      percentile25: percentile25 ?? value * 0.75,
      percentile50: percentile50 ?? value,
      percentile75: percentile75 ?? value * 1.25,
      percentile90: percentile90 ?? value * 1.5,
      source: source ?? 'manual',
      updatedAt: new Date(),
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error('Failed to update benchmark', error);
    return res.status(500).json({ error: 'Failed to update benchmark' });
  }
});

export default router;
