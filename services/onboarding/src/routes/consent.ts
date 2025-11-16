import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { consentLedgerService, CreateConsentInput } from '../services/consentLedger';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('onboarding-service');

// Record consent
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const input: CreateConsentInput = {
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      consentType: req.body.consentType,
      consentScope: req.body.consentScope,
      provider: req.body.provider,
      consentText: req.body.consentText,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || undefined,
      consentMethod: req.body.consentMethod || 'web_form',
      expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
      gdprBasis: req.body.gdprBasis,
      ccpaOptOut: req.body.ccpaOptOut,
      dataUsageStatement: req.body.dataUsageStatement,
      metadata: req.body.metadata,
    };

    if (!input.consentType || !input.consentText) {
      throw new ValidationError('Consent type and text are required');
    }

    const consentId = await consentLedgerService.recordConsent(input);

    res.status(201).json({ consentId });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Record consent failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to record consent' });
  }
});

// Get tenant consents
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const consents = await consentLedgerService.getTenantConsents(req.user.tenantId);
    res.json({ consents });
  } catch (error) {
    logger.error('Get consents failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get consents' });
  }
});

// Check consent
router.get('/check', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { consentType, consentScope } = req.query;

    if (!consentType) {
      throw new ValidationError('Consent type is required');
    }

    const hasConsent = await consentLedgerService.checkConsent(
      req.user.tenantId,
      consentType as any,
      consentScope as string | undefined
    );

    res.json({ hasConsent });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Check consent failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to check consent' });
  }
});

// Revoke consent
router.post('/:consentId/revoke', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { consentId } = req.params;
    const { reason } = req.body;

    await consentLedgerService.revokeConsent(consentId, req.user.userId, reason);

    res.json({ message: 'Consent revoked successfully' });
  } catch (error) {
    logger.error('Revoke consent failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to revoke consent' });
  }
});

export { router as consentRouter };
