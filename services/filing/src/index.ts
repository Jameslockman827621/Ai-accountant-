import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { filingRouter } from './routes/filings';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { startFilingScheduler } from './scheduler';
import { metricsMiddleware } from '@ai-accountant/monitoring-service/middleware/metricsMiddleware';
import { tracingMiddleware } from '@ai-accountant/monitoring-service/middleware/tracingMiddleware';

config();

const app: Express = express();
const logger = createLogger('filing-service');
const PORT = process.env.PORT || 3007;

app.use(tracingMiddleware('filing-service'));
app.use(metricsMiddleware('filing-service'));
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'filing-service' });
});

app.use('/api/filings', authenticate, filingRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Filing service listening on port ${PORT}`);
  startFilingScheduler();
});

export default app;
