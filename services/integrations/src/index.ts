import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import integrationsRouter from './routes/integrations';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { metricsMiddleware } from '@ai-accountant/monitoring-service/middleware/metricsMiddleware';
import { tracingMiddleware } from '@ai-accountant/monitoring-service/middleware/tracingMiddleware';

config();

const app: Express = express();
const logger = createLogger('integrations-service');
const PORT = process.env.PORT || 3015;
const SERVICE_NAME = 'integrations-service';

const tracingHandler = (req: Request, res: Response, next: NextFunction): void => {
  res.locals.serviceName = SERVICE_NAME;
  tracingMiddleware(req, res, next);
};

const metricsHandler = (req: Request, res: Response, next: NextFunction): void => {
  res.locals.serviceName = SERVICE_NAME;
  metricsMiddleware(req, res, next);
};

app.use(tracingHandler);
app.use(metricsHandler);
app.use(helmet());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  })
);

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'integrations-service' });
});

app.use('/api/integrations', authenticate, integrationsRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Integrations service listening on port ${PORT}`);
});

export default app;
