import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { onboardingRouter } from './routes/onboarding';
import { intentProfileRouter } from './routes/intentProfile';
import { kycRouter } from './routes/kyc';
import { connectorRouter } from './routes/connectors';
import { consentRouter } from './routes/consent';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';

config();

const app: Express = express();
const logger = createLogger('onboarding-service');
const PORT = process.env.PORT || 3022;

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'onboarding-service' });
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
