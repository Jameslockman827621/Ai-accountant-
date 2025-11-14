import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { automationRouter } from './routes/automation';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { ruleScheduler } from './ruleScheduler';

config();

const app: Express = express();
const logger = createLogger('automation-service');
const PORT = process.env.PORT || 3014;

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'automation-service' });
});

app.use('/api/automation', authenticate, automationRouter);

app.use(errorHandler);

// Start rule scheduler
ruleScheduler.startScheduler(60000); // Run every minute

app.listen(PORT, () => {
  logger.info(`Automation service listening on port ${PORT}`);
});

export default app;
