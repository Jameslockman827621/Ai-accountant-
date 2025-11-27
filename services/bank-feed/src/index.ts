import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createServiceLogger, createMetricsMiddleware, createTracingMiddleware } from '@ai-accountant/observability';
import { bankFeedRouter } from './routes/bank-feed';
import { bankFeedWebhookRouter } from './routes/webhooks';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { startTokenMaintenance } from './services/tokenMaintenance';
import { startRetryWorker } from './workers/retryWorker';
import { startFreshnessMonitor } from './workers/freshnessMonitorWorker';

config();

const SERVICE_NAME = 'bank-feed-service';
const app: Express = express();
const logger = createServiceLogger(SERVICE_NAME);
const PORT = process.env.PORT || 3016;

app.use(createTracingMiddleware(SERVICE_NAME));
app.use(createMetricsMiddleware(SERVICE_NAME));
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'bank-feed-service' });
});

app.use('/api/bank-feed/webhooks', bankFeedWebhookRouter);
app.use('/api/bank-feed', authenticate, bankFeedRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Bank feed service listening on port ${PORT}`);
});

startTokenMaintenance();
startRetryWorker();
startFreshnessMonitor();

export default app;
