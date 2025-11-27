import { Router } from 'express';
import { metricsCollector, recordExternalAPICall } from '../services/metrics';

const router = Router();

router.post('/telemetry/connectivity', (req, res) => {
  const {
    sourceService,
    targetService,
    durationMs,
    success,
    attempt,
    errorMessage,
  } = req.body ?? {};

  if (!sourceService || !targetService || typeof success !== 'boolean') {
    res.status(400).json({ error: 'sourceService, targetService, and success are required' });
    return;
  }

  const duration = typeof durationMs === 'number' ? durationMs : 0;
  const attemptValue = typeof attempt === 'number' ? attempt : 1;

  recordExternalAPICall(sourceService, targetService, duration, success);
  metricsCollector.recordMetric({
    name: 'connectivity_check',
    value: success ? 1 : 0,
    tags: {
      source: sourceService,
      target: targetService,
      attempt: String(attemptValue),
      success: String(success),
    },
    timestamp: new Date(),
  });

  if (errorMessage) {
    metricsCollector.recordMetric({
      name: 'connectivity_error',
      value: 1,
      tags: {
        source: sourceService,
        target: targetService,
      },
      timestamp: new Date(),
    });
  }

  res.json({ recorded: true });
});

export { router as telemetryRouter };
