import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createServiceLogger, createMetricsMiddleware, createTracingMiddleware } from '@ai-accountant/observability';
import { onboardingRouter } from './routes/onboarding';
import { intentProfileRouter } from './routes/intentProfile';
import { kycRouter } from './routes/kyc';
import { connectorRouter } from './routes/connectors';
import { consentRouter } from './routes/consent';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { runConnectivityChecks } from './services/connectivity';

config();

const SERVICE_NAME = 'onboarding-service';
const app: Express = express();
const logger = createServiceLogger(SERVICE_NAME);
const PORT = process.env.PORT || 3022;

app.use(createTracingMiddleware(SERVICE_NAME));
app.use(createMetricsMiddleware(SERVICE_NAME));
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());

app.get('/health', async (_req, res) => {
  const connectivity = await runConnectivityChecks();
  const degraded = connectivity.dependencies.some(dep => !dep.success);
  res.json({
    status: degraded ? 'degraded' : 'ok',
    service: 'onboarding-service',
    dependencies: connectivity.dependencies,
  });
});

app.use('/api/onboarding', authenticate, onboardingRouter);
app.use('/api/intent-profile', authenticate, intentProfileRouter);
app.use('/api/kyc', authenticate, kycRouter);
app.use('/api/connectors', authenticate, connectorRouter);
app.use('/api/consent', authenticate, consentRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Onboarding service listening on port ${PORT}`);
});

export default app;
