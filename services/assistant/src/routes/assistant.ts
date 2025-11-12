import { randomUUID } from 'crypto';
import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { queryAssistant } from '../services/rag';
import { db } from '@ai-accountant/database';

const router = Router();
const logger = createLogger('assistant-service');

// Query assistant
router.post('/query', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { question } = req.body;

    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    const response = await queryAssistant(req.user.tenantId, question);

    // Log the query for monitoring
    await db.query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, 'assistant_query', 'assistant', $3, $4)`,
      [
        req.user.tenantId,
        req.user.userId,
        randomUUID(),
        JSON.stringify({ question, modelVersion: response.modelVersion }),
      ]
    );

    res.json({ response });
  } catch (error) {
    logger.error('Assistant query failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to process query' });
  }
});

export { router as assistantRouter };
