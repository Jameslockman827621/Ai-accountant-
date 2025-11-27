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
import { getPolicyStatuses, recordPolicyAcceptance, PolicyType } from '../services/legal';
import {
  getPrivacySettings,
  processErasureRequests,
  runRetentionEnforcement,
  submitErasureRequest,
  upsertPrivacySettings,
} from '../services/privacy';

const router = Router();
const logger = createLogger('compliance-service');

const LEGAL_POLICY_TYPES: PolicyType[] = ['terms_of_service', 'privacy_policy'];

function requireTenant(res: Response, user?: AuthRequest['user']): string | undefined {
  if (typeof user?.tenantId !== 'string') {
    res.status(400).json({ error: 'Missing tenant context' });
    return undefined;
  }
  return user.tenantId;
}

function requireUserId(res: Response, user?: AuthRequest['user']): string | undefined {
  if (typeof user?.userId !== 'string') {
    res.status(400).json({ error: 'Missing user context' });
    return undefined;
  }
  return user.userId;
}

const toOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

// Legal policy versioning and consent capture
router.get('/legal/policies', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const tenantId = requireTenant(res, req.user);
    const userId = requireUserId(res, req.user);
    if (tenantId === undefined || userId === undefined) {
      return;
    }

    const statuses = await getPolicyStatuses(tenantId as string, userId as string);
    res.json({ policies: statuses });
  } catch (error) {
    logger.error('Failed to fetch policy statuses', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Unable to load legal policies' });
  }
});

router.post('/legal/accept', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const tenantId = requireTenant(res, req.user);
    const userId = requireUserId(res, req.user);
    if (tenantId === undefined || userId === undefined) {
      return;
    }

    const { policyType, signature } = req.body as { policyType?: PolicyType; signature?: string };

    if (!policyType || !LEGAL_POLICY_TYPES.includes(policyType)) {
      res.status(400).json({ error: 'Invalid policy type' });
      return;
    }
    if (!signature || typeof signature !== 'string' || signature.trim().length === 0) {
      res.status(400).json({ error: 'Signature is required' });
      return;
    }

    const metadata: { userAgent?: string; ipAddress?: string } = {};
    if (typeof req.headers['user-agent'] === 'string') {
      metadata.userAgent = req.headers['user-agent'];
    }
    if (typeof req.ip === 'string' && req.ip.length > 0) {
      metadata.ipAddress = req.ip;
    }

    const acceptance = await recordPolicyAcceptance(
      tenantId as string,
      userId as string,
      policyType,
      signature.trim(),
      metadata
    );

    res.status(201).json({ acceptance });
  } catch (error) {
    logger.error('Failed to record policy acceptance', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Unable to record acceptance' });
  }
});

// Privacy controls (GDPR/CCPA)
router.get('/privacy/settings', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const tenantId = requireTenant(res, req.user);
    if (tenantId === undefined) {
      return;
    }

    const settings = await getPrivacySettings(tenantId as string);
    res.json({ settings });
  } catch (error) {
    logger.error('Failed to fetch privacy settings', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Unable to load privacy settings' });
  }
});

router.put('/privacy/settings', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const tenantId = requireTenant(res, req.user);
    if (tenantId === undefined) {
      return;
    }

    const { defaultRetentionDays, erasureGracePeriodDays, ccpaOptOut, autoDeleteEnabled } = req.body as {
      defaultRetentionDays?: number;
      erasureGracePeriodDays?: number;
      ccpaOptOut?: boolean;
      autoDeleteEnabled?: boolean;
    };

    const updates: Partial<Parameters<typeof upsertPrivacySettings>[1]> = {};
    if (defaultRetentionDays !== undefined) {
      updates.defaultRetentionDays = defaultRetentionDays;
    }
    if (erasureGracePeriodDays !== undefined) {
      updates.erasureGracePeriodDays = erasureGracePeriodDays;
    }
    if (ccpaOptOut !== undefined) {
      updates.ccpaOptOut = ccpaOptOut;
    }
    if (autoDeleteEnabled !== undefined) {
      updates.autoDeleteEnabled = autoDeleteEnabled;
    }

    const settings = await upsertPrivacySettings(tenantId as string, updates);

    res.json({ settings });
  } catch (error) {
    logger.error('Failed to update privacy settings', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof AuthorizationError) {
      res.status(403).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to update privacy settings' });
  }
});

router.post('/privacy/erasure', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const tenantId = requireTenant(res, req.user);
    const userId = requireUserId(res, req.user);
    if (tenantId === undefined || userId === undefined) {
      return;
    }

    const { reason } = req.body as { reason?: string };
    const requestId = await submitErasureRequest(tenantId as string, userId as string, reason);
    res.status(202).json({ requestId });
  } catch (error) {
    logger.error('Failed to submit erasure request', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Unable to submit erasure request' });
  }
});

router.post('/privacy/process-erasure', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const tenantId = requireTenant(res, req.user);
    if (tenantId === undefined) {
      return;
    }

    const result = await processErasureRequests(tenantId as string, req.user.userId as string);
    res.json({ result });
  } catch (error) {
    logger.error('Failed to process erasure queue', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof AuthorizationError) {
      res.status(403).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to process erasure queue' });
  }
});

router.post('/privacy/run-retention', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const tenantId = requireTenant(res, req.user);
    if (tenantId === undefined) {
      return;
    }

    const actions = await runRetentionEnforcement(tenantId as string, req.user.userId as string);
    res.json({ actions });
  } catch (error) {
    logger.error('Failed to run retention enforcement', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof AuthorizationError) {
      res.status(403).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to run retention enforcement' });
  }
});

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

    const tenantId = requireTenant(res, req.user);
    if (tenantId === undefined) {
      return;
    }
    const tenantIdValue: string = tenantId;

    const { userId, resourceType, resourceId, startDate, endDate, page, limit } = req.query;

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
      offset: page
        ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100)
        : 0,
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

    const result = await getAuditLogs(tenantIdValue, filters);

    res.json(result);
  } catch (error) {
    logger.error(
      'Get audit logs failed',
      error instanceof Error ? error : new Error(String(error))
    );
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

    const tenantId = requireTenant(res, req.user);
    const userId = requireUserId(res, req.user);
    if (tenantId === undefined || userId === undefined) {
      return;
    }

    const data = await exportUserData(tenantId, userId);

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

    const tenantId = requireTenant(res, req.user);
    const userId = requireUserId(res, req.user);
    if (tenantId === undefined || userId === undefined) {
      return;
    }

    await deleteUserData(tenantId, userId);

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

    const tenantId = requireTenant(res, req.user);
    if (tenantId === undefined) {
      return;
    }
    const tenantIdValue: string = tenantId;

    const { startDate, endDate } = req.query;
    const start = (toOptionalString(startDate) ?? new Date().toISOString().split('T')[0]) as string;
    const end = (toOptionalString(endDate) ??
      new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]) as string;

    const calendar = await complianceCalendarService.generateCalendar(tenantIdValue, start, end);

    res.json({ calendar });
  } catch (error) {
    logger.error(
      'Get compliance calendar failed',
      error instanceof Error ? error : new Error(String(error))
    );
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

    const tenantId = requireTenant(res, req.user);
    if (tenantId === undefined) {
      return;
    }
    const tenantIdValue: string = tenantId;

    const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
    const deadlines = await complianceCalendarService.getUpcomingDeadlines(tenantIdValue, days);

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

    const tenantId = requireTenant(res, req.user);
    if (tenantId === undefined) {
      return;
    }
    const tenantIdValue: string = tenantId;

    await complianceCalendarService.updateReadinessScores(tenantIdValue);
    res.json({ message: 'Readiness scores updated' });
  } catch (error) {
    logger.error(
      'Update readiness failed',
      error instanceof Error ? error : new Error(String(error))
    );
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

    const tenantId = requireTenant(res, req.user);
    if (tenantId === undefined) {
      return;
    }
    const tenantIdValue: string = tenantId;

    const {
      dataType,
      sensitivityLevel,
      dataResidencyRegion,
      jurisdiction,
      storageLocation,
      encryptionAtRest,
      encryptionInTransit,
      retentionPolicyDays,
      autoDeleteEnabled,
      accessControls,
      allowedRegions,
    } = req.body;
    const classification = await dataClassificationService.createClassification(
      tenantIdValue,
      dataType,
      sensitivityLevel,
      dataResidencyRegion,
      {
        jurisdiction,
        storageLocation,
        encryptionAtRest,
        encryptionInTransit,
        retentionPolicyDays,
        autoDeleteEnabled,
        accessControls,
        allowedRegions,
      }
    );

    res.status(201).json(classification);
  } catch (error) {
    logger.error(
      'Error creating data classification',
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
});

router.get('/data-classification', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const tenantId = requireTenant(res, req.user);
    if (tenantId === undefined) {
      return;
    }
    const tenantIdValue: string = tenantId;

    const classifications = await dataClassificationService.getClassifications(tenantIdValue);
    res.json(classifications);
  } catch (error) {
    logger.error(
      'Error getting data classifications',
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
});

router.patch('/data-classification/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const classificationId = req.params.id;
    if (!classificationId) {
      res.status(400).json({ error: 'Missing classification id' });
      return;
    }

    const classification = await dataClassificationService.updateClassification(
      classificationId,
      req.body
    );
    res.json(classification);
  } catch (error) {
    logger.error(
      'Error updating data classification',
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
});

// Access Review Routes
router.post('/access-reviews', async (req: AuthRequest, res: Response) => {
  try {
    if (
      !req.user ||
      (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)
    ) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const userIdFromToken = requireUserId(res, req.user);
    if (userIdFromToken === undefined) {
      return;
    }
    const reviewerId: string = userIdFromToken;

    const {
      reviewType,
      tenantId: tenantIdRaw,
      userId: userIdRaw,
      resourceType,
      resourceId,
      currentPermissions,
      recommendedChanges,
      justification,
      reviewNotes,
      metadata,
    } = req.body;
    const fallbackTenant = toOptionalString(tenantIdRaw) ?? requireTenant(res, req.user);
    if (fallbackTenant === undefined) {
      return;
    }
    const tenantIdForReview: string = fallbackTenant;

    const reviewOptions: Parameters<typeof accessReviewService.createReview>[2] = {
      tenantId: tenantIdForReview,
      resourceType,
      resourceId,
      currentPermissions,
      recommendedChanges,
      justification,
      reviewNotes,
      metadata,
    };

    const userIdValue = toOptionalString(userIdRaw);
    if (userIdValue) {
      reviewOptions.userId = userIdValue;
    }

    const review = await accessReviewService.createReview(reviewType, reviewerId, reviewOptions);

    res.status(201).json(review);
  } catch (error) {
    logger.error(
      'Error creating access review',
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
});

router.get('/access-reviews', async (req: AuthRequest, res: Response) => {
  try {
    if (
      !req.user ||
      (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)
    ) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { tenantId, userId, reviewType, reviewStatus, page, limit } = req.query;
    const fallbackTenant = toOptionalString(tenantId) ?? requireTenant(res, req.user);
    if (fallbackTenant === undefined) {
      return;
    }
    const tenantIdFilterValue: string = fallbackTenant;

    const reviewFilters: Parameters<typeof accessReviewService.getReviews>[0] = {
      tenantId: tenantIdFilterValue,
    };

    const userFilter = toOptionalString(userId);
    if (userFilter) {
      reviewFilters.userId = userFilter;
    }

    const reviewTypeFilter = toOptionalString(reviewType);
    if (reviewTypeFilter) {
      reviewFilters.reviewType = reviewTypeFilter as
        | 'user_access'
        | 'role_permissions'
        | 'api_keys'
        | 'service_accounts';
    }

    const reviewStatusFilter = toOptionalString(reviewStatus);
    if (reviewStatusFilter) {
      reviewFilters.reviewStatus = reviewStatusFilter as
        | 'approved'
        | 'revoked'
        | 'needs_justification';
    }

    if (limit) {
      reviewFilters.limit = parseInt(limit as string, 10);
    }

    if (page) {
      reviewFilters.offset =
        (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100);
    }

    const { reviews, total } = await accessReviewService.getReviews(reviewFilters);

    res.json({
      reviews,
      total,
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 100,
    });
  } catch (error) {
    logger.error(
      'Error getting access reviews',
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
});

router.patch('/access-reviews/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    if (
      !req.user ||
      (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)
    ) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const userIdFromToken = requireUserId(res, req.user);
    if (userIdFromToken === undefined) {
      return;
    }
    const reviewerId: string = userIdFromToken;

    const { reviewStatus, reviewNotes, actionTaken, actionTakenBy } = req.body;
    const reviewId = req.params.id;
    if (!reviewId) {
      res.status(400).json({ error: 'Missing review id' });
      return;
    }

    const review = await accessReviewService.updateReviewStatus(reviewId, reviewStatus, {
      reviewNotes,
      actionTaken,
      actionTakenBy: actionTakenBy || reviewerId,
    });

    res.json(review);
  } catch (error) {
    logger.error(
      'Error updating access review',
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
});

// Compliance Evidence Routes
router.post('/evidence', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can create compliance evidence');
    }

    const {
      complianceFramework,
      controlId,
      controlName,
      evidenceType,
      evidenceUrl,
      evidenceData,
      effectiveFrom,
      effectiveTo,
      nextReviewDue,
    } = req.body;
    const evidenceOptions: Parameters<typeof complianceEvidenceService.createEvidence>[4] = {};

    if (evidenceUrl) {
      evidenceOptions.evidenceUrl = evidenceUrl;
    }
    if (evidenceData) {
      evidenceOptions.evidenceData = evidenceData;
    }
    if (effectiveFrom) {
      evidenceOptions.effectiveFrom = new Date(effectiveFrom);
    }
    if (effectiveTo) {
      evidenceOptions.effectiveTo = new Date(effectiveTo);
    }
    if (nextReviewDue) {
      evidenceOptions.nextReviewDue = new Date(nextReviewDue);
    }

    const evidence = await complianceEvidenceService.createEvidence(
      complianceFramework,
      controlId,
      controlName,
      evidenceType,
      evidenceOptions
    );

    res.status(201).json(evidence);
  } catch (error) {
    logger.error(
      'Error creating compliance evidence',
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
});

router.get('/evidence', async (req: AuthRequest, res: Response) => {
  try {
    if (
      !req.user ||
      (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)
    ) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { complianceFramework, controlId, status, page, limit } = req.query;
    const evidenceFilters: Parameters<typeof complianceEvidenceService.getEvidenceByFramework>[1] =
      {};

    const controlIdFilter = toOptionalString(controlId);
    if (controlIdFilter) {
      evidenceFilters.controlId = controlIdFilter;
    }

    const statusFilter = toOptionalString(status);
    if (statusFilter) {
      evidenceFilters.status = statusFilter as 'draft' | 'reviewed' | 'approved' | 'expired';
    }

    if (limit) {
      evidenceFilters.limit = parseInt(limit as string, 10);
    }

    if (page) {
      evidenceFilters.offset =
        (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100);
    }

    const { evidence, total } = await complianceEvidenceService.getEvidenceByFramework(
      complianceFramework as 'soc2' | 'iso27001' | 'gdpr' | 'hipaa' | 'other',
      evidenceFilters
    );

    res.json({
      evidence,
      total,
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 100,
    });
  } catch (error) {
    logger.error(
      'Error getting compliance evidence',
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
});

router.get('/evidence/due-reviews', async (req: AuthRequest, res: Response) => {
  try {
    if (
      !req.user ||
      (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)
    ) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const dueReviews = await complianceEvidenceService.getDueReviews();
    res.json(dueReviews);
  } catch (error) {
    logger.error(
      'Error getting due reviews',
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
});

router.patch('/evidence/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    if (
      !req.user ||
      (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)
    ) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const userIdFromToken = requireUserId(res, req.user);
    if (userIdFromToken === undefined) {
      return;
    }
    const reviewerId: string = userIdFromToken;

    const { status, reviewedBy, approvedBy, lastVerifiedAt } = req.body;
    const evidenceId = req.params.id;
    if (!evidenceId) {
      res.status(400).json({ error: 'Missing evidence id' });
      return;
    }

    const evidenceUpdateOptions: Parameters<
      typeof complianceEvidenceService.updateEvidenceStatus
    >[2] = {
      reviewedBy: reviewedBy || reviewerId,
      approvedBy: approvedBy || reviewerId,
    };

    if (lastVerifiedAt) {
      evidenceUpdateOptions.lastVerifiedAt = new Date(lastVerifiedAt);
    }

    const evidence = await complianceEvidenceService.updateEvidenceStatus(
      evidenceId,
      status,
      evidenceUpdateOptions
    );

    res.json(evidence);
  } catch (error) {
    logger.error(
      'Error updating evidence status',
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
});

export { router as complianceRouter };
