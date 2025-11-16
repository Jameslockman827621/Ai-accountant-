import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { chaosRouter } from './routes/chaos';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';

config();

const app: Express = express();
const logger = createLogger('chaos-service');
const PORT = process.env.PORT || 3023;

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'chaos-service' });
});

app.use('/api/chaos', authenticate, chaosRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Chaos service listening on port ${PORT}`);
});

export default app;
