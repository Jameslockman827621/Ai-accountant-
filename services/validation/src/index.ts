import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { validationRouter } from './routes/validation';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';

config();

const app: Express = express();
const logger = createLogger('validation-service');
const PORT = process.env.PORT || 3020;

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'validation-service' });
});

app.use('/api/validation', authenticate, validationRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Validation service listening on port ${PORT}`);
});

export default app;
