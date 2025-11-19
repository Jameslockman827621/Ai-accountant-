import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createServiceLogger, createMetricsMiddleware, createTracingMiddleware } from '@ai-accountant/observability';
import { ledgerRouter } from './routes/ledger';
import { periodCloseRouter } from './routes/periodClose';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';

config();

const SERVICE_NAME = 'ledger-service';
const app: Express = express();
const logger = createServiceLogger(SERVICE_NAME);
const PORT = process.env.PORT || 3003;

app.use(createTracingMiddleware(SERVICE_NAME));
app.use(createMetricsMiddleware(SERVICE_NAME));
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ledger-service' });
});

app.use('/api/ledger', authenticate, ledgerRouter);
app.use('/api/ledger/period-close', authenticate, periodCloseRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Ledger service listening on port ${PORT}`);
});

export default app;
