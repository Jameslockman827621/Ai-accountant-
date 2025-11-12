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
    onProxyReq: (proxyReq, req) => {
      logger.debug(`Proxying ${req.method} ${req.url} to ${target}`);
    },
    onError: (err, req) => {
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
  });
});

export default app;
