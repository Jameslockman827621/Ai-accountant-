import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { documentRouter } from './routes/documents';
import { ingestionRouter } from './routes/ingestion';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { connectQueue } from './messaging/queue';
import { metricsMiddleware } from '@ai-accountant/monitoring-service/middleware/metricsMiddleware';
import { tracingMiddleware } from '@ai-accountant/monitoring-service/middleware/tracingMiddleware';

config();

const app: Express = express();
const logger = createLogger('document-ingest-service');
const PORT = process.env.PORT || 3002;

app.use(tracingMiddleware('document-ingest-service'));
app.use(metricsMiddleware('document-ingest-service'));
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'document-ingest-service' });
});

app.use('/api/documents', authenticate, documentRouter);
app.use('/api/ingestion', ingestionRouter); // Mix of public (email/webhook) and protected routes

app.use(errorHandler);

async function bootstrap(): Promise<void> {
  try {
    await connectQueue();
    logger.info('Message queue ready');
  } catch (error) {
    logger.error('Unable to connect to message queue', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }

  app.listen(PORT, () => {
    logger.info(`Document ingest service listening on port ${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  void bootstrap();
}

export default app;
export { app, bootstrap };
