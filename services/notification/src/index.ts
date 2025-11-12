import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { notificationRouter } from './routes/notifications';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { startScheduler } from './scheduler';

config();

const app: Express = express();
const logger = createLogger('notification-service');
const PORT = process.env.PORT || 3009;

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
