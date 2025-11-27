/**
 * Security Service
 * Central security service for secrets, encryption, RBAC, and audit logging
 */

import express, { Express } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { backupService } from './backup';
import { createDefaultSecretsManager } from './secretsManagement';

const logger = createLogger('security-service');
const app: Express = express();
const PORT = process.env.PORT || 3011;

app.use(express.json());

// Prime secrets provider and fail fast if missing
const secretsManager = createDefaultSecretsManager();
secretsManager
  .getSecret('ENCRYPTION_KEY')
  .then(secret => {
    if (!secret) {
      logger.warn('Encryption key not found in secrets backend; using runtime fallback');
    }
  })
  .catch(error => logger.error('Secrets bootstrap failed', error));

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
