import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { authRouter } from './routes/auth';
import { userRouter } from './routes/users';
import { tenantRouter } from './routes/tenants';
import { organizationRouter } from './routes/organizations';
import { errorHandler } from './middleware/errorHandler';

config();

const app: Express = express();
const logger = createLogger('auth-service');
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'auth-service' });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/users', userRouter);
app.use('/api/tenants', tenantRouter);
app.use('/api/organizations', organizationRouter);

// Error handling
app.use(errorHandler);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  logger.info(`Auth service listening on port ${PORT}`);
});

export default app;
