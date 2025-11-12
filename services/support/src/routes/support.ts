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
} from '../services/tickets';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('support-service');

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

    const { status } = req.query;
    const userId = req.user.role === 'client' ? req.user.userId : undefined;

    const tickets = await getTickets(
      req.user.tenantId,
      userId,
      status as string | undefined
    );

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
    const { status, resolution } = req.body;

    if (!status) {
      throw new ValidationError('status is required');
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

export { router as supportRouter };
