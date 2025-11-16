import { Router } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { connectXero, syncXeroContacts, syncXeroTransactions } from '../services/xero';
import { connectQuickBooks, syncQuickBooksAccounts, syncQuickBooksTransactions } from '../services/quickbooks';
import { quickBooksOAuth } from '../quickbooksOAuth';
import { xeroOAuth } from '../xeroOAuth';
import quickbooksWebhooks from './quickbooksWebhooks';
import xeroWebhooks from './xeroWebhooks';

const logger = createLogger('integrations-routes');
const router = Router();

// Mount webhook routes
router.use(quickbooksWebhooks);
router.use(xeroWebhooks);

// QuickBooks OAuth routes
router.get('/quickbooks/oauth/initiate', async (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/integrations/quickbooks/callback`;
    const authUrl = await quickBooksOAuth.initiateOAuth(tenantId, redirectUri);
    
    res.json({ authUrl });
  } catch (error) {
    logger.error('QuickBooks OAuth initiation failed', error);
    res.status(500).json({ error: 'Failed to initiate OAuth' });
  }
});

router.get('/quickbooks/oauth/callback', async (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    const { code, state } = req.query;

    if (!tenantId || !code || !state) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const tokens = await quickBooksOAuth.handleCallback(tenantId, code as string, state as string);
    
    res.redirect(`${process.env.APP_URL || 'http://localhost:3000'}/integrations?connected=quickbooks`);
  } catch (error) {
    logger.error('QuickBooks OAuth callback failed', error);
    res.redirect(`${process.env.APP_URL || 'http://localhost:3000'}/integrations?error=quickbooks_oauth_failed`);
  }
});

// Xero OAuth routes
router.get('/xero/oauth/initiate', async (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/integrations/xero/callback`;
    const authUrl = await xeroOAuth.initiateOAuth(tenantId, redirectUri);
    
    res.json({ authUrl });
  } catch (error) {
    logger.error('Xero OAuth initiation failed', error);
    res.status(500).json({ error: 'Failed to initiate OAuth' });
  }
});

router.get('/xero/oauth/callback', async (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    const { code, state } = req.query;

    if (!tenantId || !code || !state) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const tokens = await xeroOAuth.handleCallback(tenantId, code as string, state as string);
    
    res.redirect(`${process.env.APP_URL || 'http://localhost:3000'}/integrations?connected=xero`);
  } catch (error) {
    logger.error('Xero OAuth callback failed', error);
    res.redirect(`${process.env.APP_URL || 'http://localhost:3000'}/integrations?error=xero_oauth_failed`);
  }
});

// Existing integration routes (keep existing code)
// ... (rest of the existing routes)

export default router;
