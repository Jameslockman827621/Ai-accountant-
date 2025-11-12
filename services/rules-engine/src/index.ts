import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { rulesRouter } from './routes/rules';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';

config();

const app: Express = express();
const logger = createLogger('rules-engine-service');
const PORT = process.env.PORT || 3004;

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'rules-engine-service' });
});

app.use('/api/rules', authenticate, rulesRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Rules engine service listening on port ${PORT}`);
});

export default app;
