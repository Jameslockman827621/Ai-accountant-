/**
 * Security Service
 * Central security service for secrets, encryption, RBAC, and audit logging
 */

import express, { Express } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { backupService } from './backup';

const logger = createLogger('security-service');
const app: Express = express();
const PORT = process.env.PORT || 3011;

app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'security-service' });
});

// Start scheduled backups if enabled
if (process.env.ENABLE_SCHEDULED_BACKUPS === 'true') {
  backupService.startScheduledBackups();
}

app.listen(PORT, () => {
  logger.info(`Security service listening on port ${PORT}`);
});

export default app;
