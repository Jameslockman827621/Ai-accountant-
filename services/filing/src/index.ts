import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createServiceLogger, createMetricsMiddleware, createTracingMiddleware } from '@ai-accountant/observability';
import { filingRouter } from './routes/filings';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { startFilingScheduler } from './scheduler';
import { initializeReceiptBucket } from './storage/receiptStorage';
import { initializeEvidenceBucket } from './storage/evidenceStorage';

config();

const SERVICE_NAME = 'filing-service';
const app: Express = express();
const logger = createServiceLogger(SERVICE_NAME);
const PORT = process.env.PORT || 3007;

app.use(createTracingMiddleware(SERVICE_NAME));
app.use(createMetricsMiddleware(SERVICE_NAME));
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'filing-service' });
});

app.use('/api/filings', authenticate, filingRouter);

app.use(errorHandler);

initializeReceiptBucket().catch(error => {
  logger.warn('Receipt bucket initialization skipped', error instanceof Error ? error : new Error(String(error)));
});
initializeEvidenceBucket().catch(error => {
  logger.warn('Evidence bucket initialization skipped', error instanceof Error ? error : new Error(String(error)));
});

app.listen(PORT, () => {
  logger.info(`Filing service listening on port ${PORT}`);
  startFilingScheduler();
});

export default app;
