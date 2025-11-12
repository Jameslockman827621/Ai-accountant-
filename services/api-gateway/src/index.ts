import express, { Express, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';

config();

const app: Express = express();
const logger = createLogger('api-gateway');
const PORT = process.env.PORT || 3000;

// Service URLs
const AUTH_SERVICE = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const DOCUMENT_SERVICE = process.env.DOCUMENT_SERVICE_URL || 'http://localhost:3002';
const LEDGER_SERVICE = process.env.LEDGER_SERVICE_URL || 'http://localhost:3003';
const RULES_SERVICE = process.env.RULES_SERVICE_URL || 'http://localhost:3004';
const ASSISTANT_SERVICE = process.env.ASSISTANT_SERVICE_URL || 'http://localhost:3005';
const BILLING_SERVICE = process.env.BILLING_SERVICE_URL || 'http://localhost:3006';
const FILING_SERVICE = process.env.FILING_SERVICE_URL || 'http://localhost:3007';
const RECONCILIATION_SERVICE = process.env.RECONCILIATION_SERVICE_URL || 'http://localhost:3008';
const NOTIFICATION_SERVICE = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3009';
const COMPLIANCE_SERVICE = process.env.COMPLIANCE_SERVICE_URL || 'http://localhost:3010';
const MONITORING_SERVICE = process.env.MONITORING_SERVICE_URL || 'http://localhost:3019';
const WORKFLOW_SERVICE = process.env.WORKFLOW_SERVICE_URL || 'http://localhost:3011';
const ACCOUNTANT_SERVICE = process.env.ACCOUNTANT_SERVICE_URL || 'http://localhost:3012';
const ANALYTICS_SERVICE = process.env.ANALYTICS_SERVICE_URL || 'http://localhost:3013';
const AUTOMATION_SERVICE = process.env.AUTOMATION_SERVICE_URL || 'http://localhost:3014';
const INTEGRATIONS_SERVICE = process.env.INTEGRATIONS_SERVICE_URL || 'http://localhost:3015';
const BANK_FEED_SERVICE = process.env.BANK_FEED_SERVICE_URL || 'http://localhost:3016';
const CLASSIFICATION_SERVICE = process.env.CLASSIFICATION_SERVICE_URL || 'http://localhost:3017';
const OCR_SERVICE = process.env.OCR_SERVICE_URL || 'http://localhost:3018';

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
  });
});

// Proxy middleware factory
function createServiceProxy(target: string, pathRewrite?: Record<string, string>) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: pathRewrite || {},
    onProxyReq: (_proxyReq, req) => {
      logger.debug(`Proxying ${req.method} ${req.url} to ${target}`);
    },
    onError: (err: Error, req) => {
      logger.error(`Proxy error for ${req.url}`, err);
    },
  });
}

// Route to services
app.use('/api/auth', createServiceProxy(AUTH_SERVICE, { '^/api/auth': '/api/auth' }));
app.use('/api/documents', createServiceProxy(DOCUMENT_SERVICE, { '^/api/documents': '/api/documents' }));
app.use('/api/ledger', createServiceProxy(LEDGER_SERVICE, { '^/api/ledger': '/api/ledger' }));
app.use('/api/rules', createServiceProxy(RULES_SERVICE, { '^/api/rules': '/api/rules' }));
app.use('/api/assistant', createServiceProxy(ASSISTANT_SERVICE, { '^/api/assistant': '/api/assistant' }));
app.use('/api/billing', createServiceProxy(BILLING_SERVICE, { '^/api/billing': '/api/billing' }));
app.use('/api/filings', createServiceProxy(FILING_SERVICE, { '^/api/filings': '/api/filings' }));
app.use('/api/reconciliation', createServiceProxy(RECONCILIATION_SERVICE, { '^/api/reconciliation': '/api/reconciliation' }));
app.use('/api/notifications', createServiceProxy(NOTIFICATION_SERVICE, { '^/api/notifications': '/api/notifications' }));
app.use('/api/compliance', createServiceProxy(COMPLIANCE_SERVICE, { '^/api/compliance': '/api/compliance' }));
app.use('/api/monitoring', createServiceProxy(MONITORING_SERVICE, { '^/api/monitoring': '' }));
app.use('/api/workflows', createServiceProxy(WORKFLOW_SERVICE, { '^/api/workflows': '/api/workflows' }));
app.use('/api/accountant', createServiceProxy(ACCOUNTANT_SERVICE, { '^/api/accountant': '/api/accountant' }));
app.use('/api/analytics', createServiceProxy(ANALYTICS_SERVICE, { '^/api/analytics': '/api/analytics' }));
app.use('/api/automation', createServiceProxy(AUTOMATION_SERVICE, { '^/api/automation': '/api/automation' }));
app.use('/api/integrations', createServiceProxy(INTEGRATIONS_SERVICE, { '^/api/integrations': '/api/integrations' }));
app.use('/api/bank-feed', createServiceProxy(BANK_FEED_SERVICE, { '^/api/bank-feed': '/api/bank-feed' }));

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: unknown) => {
  logger.error('Gateway error', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info(`API Gateway listening on port ${PORT}`);
  logger.info('Service routes:', {
    auth: AUTH_SERVICE,
    documents: DOCUMENT_SERVICE,
    ledger: LEDGER_SERVICE,
    rules: RULES_SERVICE,
    assistant: ASSISTANT_SERVICE,
    billing: BILLING_SERVICE,
    filing: FILING_SERVICE,
    reconciliation: RECONCILIATION_SERVICE,
    notification: NOTIFICATION_SERVICE,
    compliance: COMPLIANCE_SERVICE,
    monitoring: MONITORING_SERVICE,
    workflow: WORKFLOW_SERVICE,
    accountant: ACCOUNTANT_SERVICE,
    analytics: ANALYTICS_SERVICE,
    automation: AUTOMATION_SERVICE,
    integrations: INTEGRATIONS_SERVICE,
    bankFeed: BANK_FEED_SERVICE,
  });
});

export default app;
