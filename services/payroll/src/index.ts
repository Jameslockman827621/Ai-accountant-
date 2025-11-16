import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { payrollRouter } from './routes/payroll';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { startSyncScheduler } from './scheduler/syncScheduler';

config();

const app: Express = express();
const logger = createLogger('payroll-service');
const PORT = process.env.PORT || 3017;

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'payroll-service' });
});

app.use('/api/payroll', authenticate, payrollRouter);

app.use(errorHandler);

// Start sync scheduler
startSyncScheduler();

app.listen(PORT, () => {
  logger.info(`Payroll service listening on port ${PORT}`);
});

export default app;
