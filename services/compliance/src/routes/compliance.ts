import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { deleteUserData, exportUserData } from '../services/gdpr';
import { getAuditLogs } from '../services/audit';
import { complianceCalendarService } from '../services/complianceCalendar';
import { dataClassificationService } from '../services/dataClassification';
import { accessReviewService } from '../services/accessReview';
import { complianceEvidenceService } from '../services/complianceEvidence';
import { UserRole } from '@ai-accountant/shared-types';
import { AuthorizationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('compliance-service');

// Get audit logs
router.get('/audit-logs', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Only admins and accountants can view audit logs
    if (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const {
      userId,
      resourceType,
      resourceId,
      startDate,
      endDate,
      page,
      limit,
    } = req.query;

    const filters: {
      userId?: string;
      resourceType?: string;
      resourceId?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    } = {
      limit: limit ? parseInt(limit as string, 10) : 100,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : 0,
    };

    if (userId) {
      filters.userId = userId as string;
    }
    if (resourceType) {
      filters.resourceType = resourceType as string;
    }
    if (resourceId) {
      filters.resourceId = resourceId as string;
    }
    if (startDate) {
      filters.startDate = new Date(startDate as string);
    }
    if (endDate) {
      filters.endDate = new Date(endDate as string);
    }

    const result = await getAuditLogs(req.user.tenantId, filters);

    res.json(result);
  } catch (error) {
    logger.error('Get audit logs failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof AuthorizationError) {
      res.status(403).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to get audit logs' });
  }
});

// Export user data (GDPR)
router.get('/export-data', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const data = await exportUserData(req.user.tenantId, req.user.userId);

    res.json({ data });
  } catch (error) {
    logger.error('Export data failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Delete user data (GDPR right to erasure)
router.delete('/delete-data', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await deleteUserData(req.user.tenantId, req.user.userId);

    res.json({ message: 'User data deleted successfully' });
  } catch (error) {
    logger.error('Delete data failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to delete data' });
  }
});

// Get compliance calendar
router.get('/calendar', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate } = req.query;
    const start = startDate ? (startDate as string) : new Date().toISOString().split('T')[0];
    const end = endDate ? (endDate as string) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const calendar = await complianceCalendarService.generateCalendar(
      req.user.tenantId,
      start,
      end
    );

    res.json({ calendar });
  } catch (error) {
    logger.error('Get compliance calendar failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get compliance calendar' });
  }
});

// Get upcoming deadlines
router.get('/deadlines', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
    const deadlines = await complianceCalendarService.getUpcomingDeadlines(
      req.user.tenantId,
      days
    );

    res.json({ deadlines });
  } catch (error) {
    logger.error('Get deadlines failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get deadlines' });
  }
});

// Update readiness scores
router.post('/readiness/update', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await complianceCalendarService.updateReadinessScores(req.user.tenantId);
    res.json({ message: 'Readiness scores updated' });
  } catch (error) {
    logger.error('Update readiness failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to update readiness scores' });
  }
});

// Data Classification Routes
router.post('/data-classification', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { dataType, sensitivityLevel, dataResidencyRegion, jurisdiction, storageLocation, encryptionAtRest, encryptionInTransit, retentionPolicyDays, autoDeleteEnabled, accessControls, allowedRegions } = req.body;
    const classification = await dataClassificationService.createClassification(req.user.tenantId, dataType, sensitivityLevel, dataResidencyRegion, {
      jurisdiction,
      storageLocation,
      encryptionAtRest,
      encryptionInTransit,
      retentionPolicyDays,
      autoDeleteEnabled,
      accessControls,
      allowedRegions,
    });

    res.status(201).json(classification);
  } catch (error) {
    logger.error('Error creating data classification', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/data-classification', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const classifications = await dataClassificationService.getClassifications(req.user.tenantId);
    res.json(classifications);
  } catch (error) {
    logger.error('Error getting data classifications', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.patch('/data-classification/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const classification = await dataClassificationService.updateClassification(req.params.id, req.body);
    res.json(classification);
  } catch (error) {
    logger.error('Error updating data classification', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

// Access Review Routes
router.post('/access-reviews', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { reviewType, tenantId, userId, resourceType, resourceId, currentPermissions, recommendedChanges, justification, reviewNotes, metadata } = req.body;
    const review = await accessReviewService.createReview(reviewType, req.user.userId, {
      tenantId: tenantId || req.user.tenantId,
      userId,
      resourceType,
      resourceId,
      currentPermissions,
      recommendedChanges,
      justification,
      reviewNotes,
      metadata,
    });

    res.status(201).json(review);
  } catch (error) {
    logger.error('Error creating access review', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/access-reviews', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { tenantId, userId, reviewType, reviewStatus, page, limit } = req.query;
    const { reviews, total } = await accessReviewService.getReviews({
      tenantId: tenantId as string | undefined,
      userId: userId as string | undefined,
      reviewType: reviewType as 'user_access' | 'role_permissions' | 'api_keys' | 'service_accounts' | undefined,
      reviewStatus: reviewStatus as 'approved' | 'revoked' | 'needs_justification' | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : undefined,
    });

    res.json({ reviews, total, page: page ? parseInt(page as string, 10) : 1, limit: limit ? parseInt(limit as string, 10) : 100 });
  } catch (error) {
    logger.error('Error getting access reviews', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.patch('/access-reviews/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { reviewStatus, reviewNotes, actionTaken, actionTakenBy } = req.body;
    const review = await accessReviewService.updateReviewStatus(req.params.id, reviewStatus, {
      reviewNotes,
      actionTaken,
      actionTakenBy: actionTakenBy || req.user.userId,
    });

    res.json(review);
  } catch (error) {
    logger.error('Error updating access review', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

// Compliance Evidence Routes
router.post('/evidence', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can create compliance evidence');
    }

    const { complianceFramework, controlId, controlName, evidenceType, evidenceUrl, evidenceData, effectiveFrom, effectiveTo, nextReviewDue } = req.body;
    const evidence = await complianceEvidenceService.createEvidence(complianceFramework, controlId, controlName, evidenceType, {
      evidenceUrl,
      evidenceData,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
      effectiveTo: effectiveTo ? new Date(effectiveTo) : undefined,
      nextReviewDue: nextReviewDue ? new Date(nextReviewDue) : undefined,
    });

    res.status(201).json(evidence);
  } catch (error) {
    logger.error('Error creating compliance evidence', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/evidence', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { complianceFramework, controlId, status, page, limit } = req.query;
    const { evidence, total } = await complianceEvidenceService.getEvidenceByFramework(complianceFramework as 'soc2' | 'iso27001' | 'gdpr' | 'hipaa' | 'other', {
      controlId: controlId as string | undefined,
      status: status as 'draft' | 'reviewed' | 'approved' | 'expired' | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : undefined,
    });

    res.json({ evidence, total, page: page ? parseInt(page as string, 10) : 1, limit: limit ? parseInt(limit as string, 10) : 100 });
  } catch (error) {
    logger.error('Error getting compliance evidence', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/evidence/due-reviews', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const dueReviews = await complianceEvidenceService.getDueReviews();
    res.json(dueReviews);
  } catch (error) {
    logger.error('Error getting due reviews', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.patch('/evidence/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { status, reviewedBy, approvedBy, lastVerifiedAt } = req.body;
    const evidence = await complianceEvidenceService.updateEvidenceStatus(req.params.id, status, {
      reviewedBy: reviewedBy || req.user.userId,
      approvedBy: approvedBy || req.user.userId,
      lastVerifiedAt: lastVerifiedAt ? new Date(lastVerifiedAt) : undefined,
    });

    res.json(evidence);
  } catch (error) {
    logger.error('Error updating evidence status', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

export { router as complianceRouter };
