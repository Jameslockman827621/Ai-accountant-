import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { reconciliationRouter } from './routes/reconciliation';
import { reconciliationCockpitRouter } from './routes/reconciliationCockpit';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { reconciliationWorker } from './workers/reconciliationWorker';

config();

const app: Express = express();
const logger = createLogger('reconciliation-service');
const PORT = process.env.PORT || 3008;

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
reconciliationWorker.start();

app.listen(PORT, () => {
  logger.info(`Reconciliation service listening on port ${PORT}`);
});

export default app;
