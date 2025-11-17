import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { metricsMiddleware } from '@ai-accountant/monitoring-service/middleware/metricsMiddleware';
import { tracingMiddleware } from '@ai-accountant/monitoring-service/middleware/tracingMiddleware';
import { rulepackRouter } from './routes/rulepacks';
import { statuteRouter } from './routes/statutes';
import { authenticate } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { startRegistryScheduler } from './scheduler';

config();

const app: Express = express();
const logger = createLogger('rulepack-registry-service');
const PORT = process.env.RULEPACK_REGISTRY_PORT || process.env.PORT || 3012;

app.use(tracingMiddleware('rulepack-registry-service'));
app.use(metricsMiddleware('rulepack-registry-service'));
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  })
);
app.use(helmet());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'rulepack-registry-service' });
});

app.use('/api/rulepacks', authenticate, rulepackRouter);
app.use('/api/statutes', authenticate, statuteRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Rulepack registry service listening on port ${PORT}`);
  startRegistryScheduler();
});

export default app;
