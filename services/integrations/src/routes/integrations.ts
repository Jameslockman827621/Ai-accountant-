import { Router, type Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { quickBooksOAuth } from '../quickbooksOAuth';
import { xeroOAuth } from '../xeroOAuth';
import type { AuthRequest } from '../middleware/auth';
import quickbooksWebhooks from './quickbooksWebhooks';
import xeroWebhooks from './xeroWebhooks';

const logger = createLogger('integrations-routes');
const router = Router();

type AuthenticatedRequest = AuthRequest & {
  user: NonNullable<AuthRequest['user']>;
};

function ensureAuthenticated(req: AuthRequest, res: Response): req is AuthenticatedRequest {
  if (req.user?.tenantId) {
    return true;
  }

  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

function getQueryString(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return null;
}

function getAppBaseUrl(): string {
  return process.env.APP_URL || 'http://localhost:3000';
}

// Mount webhook routes
router.use(quickbooksWebhooks);
router.use(xeroWebhooks);

// QuickBooks OAuth routes
router.get('/quickbooks/oauth/initiate', async (req: AuthRequest, res: Response) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const redirectUri = `${getAppBaseUrl()}/integrations/quickbooks/callback`;
    const authUrl = await quickBooksOAuth.initiateOAuth(req.user.tenantId, redirectUri);
    
    return res.json({ authUrl });
  } catch (error) {
    logger.error('QuickBooks OAuth initiation failed', { error });
    return res.status(500).json({ error: 'Failed to initiate OAuth' });
  }
});

router.get('/quickbooks/oauth/callback', async (req: AuthRequest, res: Response) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const code = getQueryString(req.query.code as string | string[] | undefined);
    const state = getQueryString(req.query.state as string | string[] | undefined);

    if (!code || !state) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    await quickBooksOAuth.handleCallback(req.user.tenantId, code, state);
    
    return res.redirect(`${getAppBaseUrl()}/integrations?connected=quickbooks`);
  } catch (error) {
    logger.error('QuickBooks OAuth callback failed', { error });
    return res.redirect(`${getAppBaseUrl()}/integrations?error=quickbooks_oauth_failed`);
  }
});

// Xero OAuth routes
router.get('/xero/oauth/initiate', async (req: AuthRequest, res: Response) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const redirectUri = `${getAppBaseUrl()}/integrations/xero/callback`;
    const authUrl = await xeroOAuth.initiateOAuth(req.user.tenantId, redirectUri);
    
    return res.json({ authUrl });
  } catch (error) {
    logger.error('Xero OAuth initiation failed', { error });
    return res.status(500).json({ error: 'Failed to initiate OAuth' });
  }
});

router.get('/xero/oauth/callback', async (req: AuthRequest, res: Response) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const code = getQueryString(req.query.code as string | string[] | undefined);
    const state = getQueryString(req.query.state as string | string[] | undefined);

    if (!code || !state) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    await xeroOAuth.handleCallback(req.user.tenantId, code, state);
    
    return res.redirect(`${getAppBaseUrl()}/integrations?connected=xero`);
  } catch (error) {
    logger.error('Xero OAuth callback failed', { error });
    return res.redirect(`${getAppBaseUrl()}/integrations?error=xero_oauth_failed`);
  }
});

export default router;
