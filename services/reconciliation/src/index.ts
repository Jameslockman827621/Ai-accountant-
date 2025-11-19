import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createServiceLogger, createMetricsMiddleware, createTracingMiddleware } from '@ai-accountant/observability';
import { reconciliationRouter } from './routes/reconciliation';
import { reconciliationCockpitRouter } from './routes/reconciliationCockpit';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';

config();

const SERVICE_NAME = 'reconciliation-service';
const app: Express = express();
const logger = createServiceLogger(SERVICE_NAME);
const PORT = process.env.PORT || 3008;

app.use(createTracingMiddleware(SERVICE_NAME));
app.use(createMetricsMiddleware(SERVICE_NAME));
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'reconciliation-service' });
});

app.use('/api/reconciliation', authenticate, reconciliationRouter);
app.use('/api/reconciliation', authenticate, reconciliationCockpitRouter);

app.use(errorHandler);

// Start background reconciliation worker
// Use BullMQ if Redis is available, otherwise use simple worker
const useBullMQ = process.env.USE_BULLMQ === 'true' && process.env.REDIS_HOST;

(async () => {
  if (useBullMQ) {
    logger.info('Starting BullMQ reconciliation worker...');
    try {
      const { createReconciliationWorker } = await import('./workers/bullReconciliationWorker');
      const worker = createReconciliationWorker();
      logger.info('BullMQ reconciliation worker started', { workerId: worker.name });
    } catch (error) {
      logger.error('Failed to start BullMQ worker, falling back to simple worker', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
      const { reconciliationWorker } = await import('./workers/reconciliationWorker');
      reconciliationWorker.start();
    }
  } else {
    logger.info('Starting simple reconciliation worker...');
    const { reconciliationWorker } = await import('./workers/reconciliationWorker');
    reconciliationWorker.start();
  }
})();

app.listen(PORT, () => {
  logger.info(`Reconciliation service listening on port ${PORT}`);
});

export default app;
