import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { commerceRouter } from './routes/commerce';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';

config();

const app: Express = express();
const logger = createLogger('commerce-service');
const PORT = process.env.PORT || 3018;

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'commerce-service' });
});

app.use('/api/commerce', authenticate, commerceRouter);
app.use('/api/commerce/webhooks', commerceRouter); // Webhooks don't require auth (signature verified)

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Commerce service listening on port ${PORT}`);
});

export default app;
