import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { documentRouter } from './routes/documents';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';

config();

const app: Express = express();
const logger = createLogger('document-ingest-service');
const PORT = process.env.PORT || 3002;

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

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Document ingest service listening on port ${PORT}`);
});

export default app;
