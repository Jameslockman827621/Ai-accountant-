import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createServiceLogger, createMetricsMiddleware, createTracingMiddleware } from '@ai-accountant/observability';
import { notificationRouter } from './routes/notifications';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { startScheduler } from './scheduler';

config();

const SERVICE_NAME = 'notification-service';
const app: Express = express();
const logger = createServiceLogger(SERVICE_NAME);
const PORT = process.env.PORT || 3009;

app.use(createTracingMiddleware(SERVICE_NAME));
app.use(createMetricsMiddleware(SERVICE_NAME));
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'notification-service' });
});

app.use('/api/notifications', authenticate, notificationRouter);

app.use(errorHandler);

// Start scheduler for deadline reminders
startScheduler();

app.listen(PORT, () => {
  logger.info(`Notification service listening on port ${PORT}`);
});

export default app;
