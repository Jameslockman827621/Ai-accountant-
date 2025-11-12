import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { workflowRouter } from './routes/workflow';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';

config();

const app: Express = express();
const logger = createLogger('workflow-service');
const PORT = process.env.PORT || 3011;

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'workflow-service' });
});

app.use('/api/workflows', authenticate, workflowRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Workflow service listening on port ${PORT}`);
});

export default app;
