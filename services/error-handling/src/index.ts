import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { errorHandlingRouter } from './routes/errorHandling';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { startErrorRetryWorker } from './workers/retryWorker';

config();

const app: Express = express();
const logger = createLogger('error-handling-service');
const PORT = process.env.PORT || 3024;

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'error-handling-service' });
});

app.use('/api/errors', authenticate, errorHandlingRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Error handling service listening on port ${PORT}`);
});

startErrorRetryWorker();

export default app;
