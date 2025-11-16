import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  createTicket,
  getTicket,
  getTickets,
  updateTicketStatus,
  assignTicket,
  addComment,
  SupportTicket,
} from '../services/tickets';
import { ValidationError } from '@ai-accountant/shared-utils';
import { knowledgeBaseEngine } from '../services/knowledgeBaseEngine';
import {
  createHelpArticle,
  updateHelpArticle,
  deleteHelpArticle,
  getAllHelpArticles,
} from '../services/helpContentManager';

const router = Router();
const logger = createLogger('support-service');
const TICKET_STATUSES: ReadonlyArray<SupportTicket['status']> = [
  'open',
  'in_progress',
  'resolved',
  'closed',
];

function isTicketStatus(value: unknown): value is SupportTicket['status'] {
  return typeof value === 'string' && TICKET_STATUSES.includes(value as SupportTicket['status']);
}

// Create support ticket
router.post('/tickets', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { subject, description, priority } = req.body;

    if (!subject || !description) {
      throw new ValidationError('subject and description are required');
    }

    const ticketId = await createTicket(
      req.user.tenantId,
      req.user.userId,
      subject,
      description,
      priority || 'medium'
    );

    res.status(201).json({ ticketId, message: 'Support ticket created' });
  } catch (error) {
    logger.error('Create ticket failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create support ticket' });
  }
});

// Get tickets
router.get('/tickets', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const rawStatus = Array.isArray(req.query.status) ? req.query.status[0] : req.query.status;
    const normalizedStatus = typeof rawStatus === 'string' ? rawStatus : undefined;
    const statusFilter = normalizedStatus && isTicketStatus(normalizedStatus) ? normalizedStatus : undefined;

    if (normalizedStatus && !statusFilter) {
      throw new ValidationError('Invalid status filter');
    }

    const scopedUserId = req.user.role === 'client' ? req.user.userId : undefined;
    const tickets = await getTickets(req.user.tenantId, scopedUserId, statusFilter);

    res.json({ tickets });
  } catch (error) {
    logger.error('Get tickets failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get tickets' });
  }
});

// Get ticket by ID
router.get('/tickets/:ticketId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { ticketId } = req.params;
    if (!ticketId) {
      res.status(400).json({ error: 'ticketId is required' });
      return;
    }

    const ticket = await getTicket(ticketId, req.user.tenantId);

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    res.json({ ticket });
  } catch (error) {
    logger.error('Get ticket failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get ticket' });
  }
});

// Update ticket status
router.put('/tickets/:ticketId/status', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { ticketId } = req.params;
    if (!ticketId) {
      res.status(400).json({ error: 'ticketId is required' });
      return;
    }

    const { status, resolution } = req.body;

    if (!isTicketStatus(status)) {
      throw new ValidationError('Valid status is required');
    }

    await updateTicketStatus(ticketId, req.user.tenantId, status, resolution);

    res.json({ message: 'Ticket status updated' });
  } catch (error) {
    logger.error('Update ticket status failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to update ticket status' });
  }
});

// Assign ticket
router.post('/tickets/:ticketId/assign', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { ticketId } = req.params;
    if (!ticketId) {
      res.status(400).json({ error: 'ticketId is required' });
      return;
    }
    const { assignedTo } = req.body;

    if (!assignedTo) {
      throw new ValidationError('assignedTo is required');
    }

    await assignTicket(ticketId, req.user.tenantId, assignedTo);

    res.json({ message: 'Ticket assigned' });
  } catch (error) {
    logger.error('Assign ticket failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to assign ticket' });
  }
});

// Add comment to ticket
router.post('/tickets/:ticketId/comments', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { ticketId } = req.params;
    if (!ticketId) {
      res.status(400).json({ error: 'ticketId is required' });
      return;
    }
    const { comment, isInternal } = req.body;

    if (!comment) {
      throw new ValidationError('comment is required');
    }

    await addComment(ticketId, req.user.userId, comment, isInternal || false);

    res.json({ message: 'Comment added' });
  } catch (error) {
    logger.error('Add comment failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Search knowledge base
router.get('/knowledge-base/search', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { q, category } = req.query;

    if (!q) {
      throw new ValidationError('Search query (q) is required');
    }

    const results = await knowledgeBaseEngine.searchArticles(
      q as string,
      category as string | undefined
    );

    res.json({ results });
  } catch (error) {
    logger.error('Search knowledge base failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to search knowledge base' });
  }
});

// Get article by ID
router.get('/knowledge-base/articles/:articleId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { articleId } = req.params;
    const article = await knowledgeBaseEngine.getArticle(articleId);

    if (!article) {
      res.status(404).json({ error: 'Article not found' });
      return;
    }

    res.json({ article });
  } catch (error) {
    logger.error('Get article failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get article' });
  }
});

// Get articles by category
router.get('/knowledge-base/categories/:category', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { category } = req.params;
    const { limit } = req.query;

    const articles = await knowledgeBaseEngine.getArticlesByCategory(
      category,
      limit ? parseInt(limit as string, 10) : 20
    );

    res.json({ articles });
  } catch (error) {
    logger.error('Get articles by category failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get articles' });
  }
});

// Record article feedback
router.post('/knowledge-base/articles/:articleId/feedback', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { articleId } = req.params;
    const { helpful } = req.body;

    if (typeof helpful !== 'boolean') {
      throw new ValidationError('helpful (boolean) is required');
    }

    await knowledgeBaseEngine.recordFeedback(articleId, helpful);

    res.json({ message: 'Feedback recorded' });
  } catch (error) {
    logger.error('Record feedback failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to record feedback' });
  }
});

export { router as supportRouter };
