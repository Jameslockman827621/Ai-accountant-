import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { createServiceLogger, createMetricsMiddleware, createTracingMiddleware } from '@ai-accountant/observability';
import { billingRouter } from './routes/billing';
import { stripeWebhookHandler, braintreeWebhookHandler } from './routes/webhooks';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';

config();

const SERVICE_NAME = 'billing-service';
const app: Express = express();
const logger = createServiceLogger(SERVICE_NAME);
const PORT = process.env.PORT || 3006;

app.use(createTracingMiddleware(SERVICE_NAME));
app.use(createMetricsMiddleware(SERVICE_NAME));
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

// Webhooks must receive the raw body for signature verification
app.post('/api/billing/webhook/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);
app.post('/api/billing/webhook/braintree', express.text({ type: '*/*' }), braintreeWebhookHandler);

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'billing-service' });
});

app.use('/api/billing', authenticate, billingRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Billing service listening on port ${PORT}`);
});

export default app;
