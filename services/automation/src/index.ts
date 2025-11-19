import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createServiceLogger, createMetricsMiddleware, createTracingMiddleware } from '@ai-accountant/observability';
import { automationRouter } from './routes/automation';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { ruleScheduler } from './ruleScheduler';
import { startAutopilotScheduler } from './scheduler/autopilotScheduler';

config();

const SERVICE_NAME = 'automation-service';
const app: Express = express();
const logger = createServiceLogger(SERVICE_NAME);
const PORT = process.env.PORT || 3014;

app.use(createTracingMiddleware(SERVICE_NAME));
app.use(createMetricsMiddleware(SERVICE_NAME));
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

// Start autopilot scheduler
startAutopilotScheduler();

app.listen(PORT, () => {
  logger.info(`Automation service listening on port ${PORT}`);
});

export default app;
