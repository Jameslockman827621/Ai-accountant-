import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import { createLogger } from '@ai-accountant/shared-utils';
import { reportingRouter } from './routes/reports';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';

config();

const app: Express = express();
const logger = createLogger('reporting-service');
const PORT = process.env.PORT || 3009;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api', limiter);

app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'reporting-service' });
});

// Routes
app.use('/api/reports', authenticate, reportingRouter);

// Error handling
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Reporting service listening on port ${PORT}`);
});
