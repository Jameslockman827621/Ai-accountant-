/**
 * Bulk Operations API Routes
 */

import { Router } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { bulkOperationsService } from '../services/bulkOperations';

const logger = createLogger('bulk-operations-routes');
const router = Router();

// Create bulk operation
router.post('/', async (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    const { type, itemIds } = req.body;

    if (!tenantId || !type || !itemIds || !Array.isArray(itemIds)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let result;
    switch (type) {
      case 'document_processing':
        result = await bulkOperationsService.processBulkDocuments(
          tenantId,
          itemIds,
          (req as any).user?.id || 'system'
        );
        break;
      case 'categorization':
        const { categoryId } = req.body;
        if (!categoryId) {
          return res.status(400).json({ error: 'categoryId required for categorization' });
        }
        result = await bulkOperationsService.processBulkCategorization(
          tenantId,
          itemIds,
          categoryId,
          (req as any).user?.id || 'system'
        );
        break;
      case 'ledger_posting':
        result = await bulkOperationsService.processBulkLedgerPosting(
          tenantId,
          itemIds,
          (req as any).user?.id || 'system'
        );
        break;
      case 'filing_creation':
        result = await bulkOperationsService.processBulkFilingCreation(
          tenantId,
          itemIds,
          (req as any).user?.id || 'system'
        );
        break;
      default:
        return res.status(400).json({ error: 'Invalid operation type' });
    }

    res.json({ operation: result });
  } catch (error) {
    logger.error('Bulk operation failed', error);
    res.status(500).json({ error: 'Bulk operation failed' });
  }
});

// Get operation status
router.get('/:operationId', async (req, res) => {
  try {
    const { operationId } = req.params;
    const operation = await bulkOperationsService.getOperationStatus(operationId);

    if (!operation) {
      return res.status(404).json({ error: 'Operation not found' });
    }

    res.json({ operation });
  } catch (error) {
    logger.error('Failed to get operation status', error);
    res.status(500).json({ error: 'Failed to get operation status' });
  }
});

// List operations
router.get('/', async (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    const { status, type } = req.query;

    // In production, query from database
    const operations = await bulkOperationsService.getOperationStatus(''); // This would need a list method
    
    res.json({ operations: [] }); // Placeholder
  } catch (error) {
    logger.error('Failed to list operations', error);
    res.status(500).json({ error: 'Failed to list operations' });
  }
});

export default router;
