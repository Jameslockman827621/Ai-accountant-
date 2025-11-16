import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { kycService, KYCVerificationRequest } from '../services/kyc';
import { ValidationError, AuthorizationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('onboarding-service');

// Initiate KYC verification
router.post('/verify', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const request: KYCVerificationRequest = {
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      verificationType: req.body.verificationType || 'identity',
      provider: req.body.provider,
      documentType: req.body.documentType,
      documentReferences: req.body.documentReferences,
      metadata: req.body.metadata,
    };

    const verificationId = await kycService.initiateVerification(request);

    res.status(201).json({ verificationId });
  } catch (error) {
    logger.error('Initiate KYC verification failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to initiate KYC verification' });
  }
});

// Get verification status
router.get('/verify/:verificationId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { verificationId } = req.params;
    const verification = await kycService.getVerification(verificationId);

    if (!verification) {
      res.status(404).json({ error: 'Verification not found' });
      return;
    }

    res.json({ verification });
  } catch (error) {
    logger.error('Get KYC verification failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get KYC verification' });
  }
});

// Get all tenant verifications
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const verifications = await kycService.getTenantVerifications(req.user.tenantId);
    res.json({ verifications });
  } catch (error) {
    logger.error('Get KYC verifications failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get KYC verifications' });
  }
});

// Manual review (admin only)
router.post('/verify/:verificationId/review', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Check admin role
    if (req.user.role !== 'super_admin' && req.user.role !== 'accountant') {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { verificationId } = req.params;
    const { approved, reviewNotes } = req.body;

    if (typeof approved !== 'boolean') {
      throw new ValidationError('Approved status is required');
    }

    await kycService.manualReview(verificationId, req.user.userId, approved, reviewNotes);

    res.json({ message: 'Review completed successfully' });
  } catch (error) {
    if (error instanceof ValidationError || error instanceof AuthorizationError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error('Manual review failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to complete review' });
  }
});

// Webhook handler for external providers
router.post('/webhook/:provider', async (req: AuthRequest, res: Response) => {
  try {
    const { provider } = req.params;
    const webhookData = req.body;

    // Verify webhook signature in production
    await kycService.handleWebhook(provider as any, webhookData);

    res.json({ message: 'Webhook processed' });
  } catch (error) {
    logger.error('KYC webhook failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

export { router as kycRouter };
