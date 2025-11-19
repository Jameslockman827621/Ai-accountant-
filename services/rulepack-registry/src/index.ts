import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createServiceLogger, createMetricsMiddleware, createTracingMiddleware } from '@ai-accountant/observability';
import { rulepackRouter } from './routes/rulepacks';
import { statuteRouter } from './routes/statutes';
import { authenticate } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { startRegistryScheduler } from './scheduler';

config();

const SERVICE_NAME = 'rulepack-registry-service';
const app: Express = express();
const logger = createServiceLogger(SERVICE_NAME);
const PORT = process.env.RULEPACK_REGISTRY_PORT || process.env.PORT || 3012;

app.use(createTracingMiddleware(SERVICE_NAME));
app.use(createMetricsMiddleware(SERVICE_NAME));
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
