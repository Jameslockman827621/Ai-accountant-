import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { connectorService, ConnectorConfig } from '../services/connectors';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('onboarding-service');

// Get all connectors for tenant
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const connectors = await connectorService.getTenantConnectors(req.user.tenantId);
    res.json({ connectors });
  } catch (error) {
    logger.error('Get connectors failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get connectors' });
  }
});

// Get connector by ID
router.get('/:connectorId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { connectorId } = req.params;
    const connector = await connectorService.getConnector(connectorId);

    if (!connector) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }

    res.json({ connector });
  } catch (error) {
    logger.error('Get connector failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get connector' });
  }
});

// Register new connector
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const config: ConnectorConfig = {
      tenantId: req.user.tenantId,
      connectorType: req.body.connectorType,
      provider: req.body.provider,
      connectorName: req.body.connectorName,
      isRequired: req.body.isRequired,
      configuration: req.body.configuration,
      scopes: req.body.scopes,
    };

    if (!config.connectorType || !config.provider || !config.connectorName) {
      throw new ValidationError('Connector type, provider, and name are required');
    }

    const connectorId = await connectorService.registerConnector(config);

    res.status(201).json({ connectorId });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Register connector failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to register connector' });
  }
});

// Initiate connection
router.post('/:connectorId/connect', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { connectorId } = req.params;
    const authResult = await connectorService.initiateConnection(
      connectorId,
      req.user.userId,
      req.body.authorizationData
    );

    res.json(authResult);
  } catch (error) {
    logger.error('Initiate connection failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to initiate connection' });
  }
});

// Complete connection
router.post('/:connectorId/complete', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { connectorId } = req.params;
    await connectorService.completeConnection(connectorId, req.user.userId, req.body);

    res.json({ message: 'Connection completed successfully' });
  } catch (error) {
    logger.error('Complete connection failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to complete connection' });
  }
});

// Disconnect connector
router.post('/:connectorId/disconnect', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { connectorId } = req.params;
    await connectorService.disconnectConnector(connectorId, req.user.userId);

    res.json({ message: 'Connector disconnected successfully' });
  } catch (error) {
    logger.error('Disconnect connector failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to disconnect connector' });
  }
});

// OAuth callback
router.get('/:connectorId/callback', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { connectorId } = req.params;
    const { code, state } = req.query;

    const connector = await connectorService.getConnector(connectorId);
    if (!connector) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }

    const result = await connectorService.handleOAuthCallback(
      connector.provider,
      connectorId,
      code as string,
      state as string
    );

    // Complete the connection
    await connectorService.completeConnection(connectorId, req.user.userId, {
      connectionId: result.connectionId,
      accountIds: result.accountIds,
    });

    // Redirect to success page
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/onboarding?connector=connected`);
  } catch (error) {
    logger.error('OAuth callback failed', error instanceof Error ? error : new Error(String(error)));
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/onboarding?connector=error`);
  }
});

export { router as connectorRouter };
