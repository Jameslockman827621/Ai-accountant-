import { randomUUID } from 'crypto';
import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { queryAssistant } from '../services/rag';
import { getDocumentReviewSuggestions } from '../services/reviewSuggestions';
import { db } from '@ai-accountant/database';
import { runAssistantEvaluation } from '../services/evaluator';
import { complianceModeService } from '../services/complianceMode';

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

// Query assistant in compliance mode
router.post('/compliance/query', async (req: AuthRequest, res: Response) => {
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

    // Get compliance context
    const context = await complianceModeService.getComplianceContext(
      req.user.tenantId,
      req.user.userId
    );

    // Generate compliance prompt
    const prompt = complianceModeService.generateCompliancePrompt(context, question);

    // Check if this is a filing preparation command
    if (question.toLowerCase().match(/(?:prepare|create|generate)\s+.+?(?:\s+return|\s+filing|$)/i)) {
      const result = await complianceModeService.handleFilingPreparationCommand(
        req.user.tenantId,
        req.user.userId,
        question
      );

      res.json({
        response: {
          answer: result.message,
          citations: [],
          modelVersion: 'compliance-mode',
          filingId: result.filingId,
          readinessCheck: result.readinessCheck,
        },
      });
      return;
    }

    // Regular compliance query
    const response = await queryAssistant(req.user.tenantId, prompt);

    res.json({ response, context });
  } catch (error) {
    logger.error('Compliance query failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to process compliance query' });
  }
});

// Explain filing calculation
router.get('/filings/:filingId/explain', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filingId } = req.params;
    const { fieldName } = req.query;

    const result = await complianceModeService.explainFilingCalculation(
      filingId,
      fieldName as string | undefined
    );

    res.json({ explanations: result.explanations });
  } catch (error) {
    logger.error('Explain filing failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to explain filing calculation' });
  }
});

router.get('/documents/:documentId/suggestions', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    const suggestions = await getDocumentReviewSuggestions(req.user.tenantId, documentId);

    res.json({ suggestions });
  } catch (error) {
    logger.error('Assistant suggestions failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

router.post('/evaluations/run', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = req.body?.limit as number | undefined;
    const report = await runAssistantEvaluation(req.user.tenantId, limit);
    res.json({ report });
  } catch (error) {
    logger.error('Assistant evaluation failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to run assistant evaluation' });
  }
});

export { router as assistantRouter };
