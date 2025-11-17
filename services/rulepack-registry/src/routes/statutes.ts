import { Router, Response } from 'express';
import { statuteMonitorService } from '../../../rules-engine/src/services/statuteMonitor';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const logger = createLogger('statute-routes');

router.post('/scan', async (_req: AuthRequest, res: Response) => {
  const results = await statuteMonitorService.scanAndRecord();
  logger.info('Statute scan completed', {
    updated: results.filter(r => r.status === 'updated').length,
    failures: results.filter(r => r.status === 'failed').length,
  });

  res.json({ results });
});

export const statuteRouter = router;
