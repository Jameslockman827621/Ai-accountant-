import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { securityEventService } from '../services/securityEvents';
import { incidentService } from '../services/incidents';
import { secretRotationService } from '../services/secretRotation';
import { UserRole } from '@ai-accountant/shared-types';
import { AuthorizationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('security-service');

// Security Events Routes
router.post('/events', async (req: AuthRequest, res: Response) => {
  try {
    const { eventType, severity, tenantId, userId, sourceIp, userAgent, resourceType, resourceId, action, description, rawEvent, metadata } = req.body;
    const event = await securityEventService.recordEvent(eventType, severity, {
      tenantId,
      userId,
      sourceIp,
      userAgent,
      resourceType,
      resourceId,
      action,
      description,
      rawEvent,
      metadata,
    });

    res.status(201).json(event);
  } catch (error) {
    logger.error('Error recording security event', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/events', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { tenantId, eventType, severity, status, page, limit } = req.query;
    const { events, total } = await securityEventService.getEvents({
      tenantId: tenantId as string | undefined,
      eventType: eventType as 'login_failure' | 'unauthorized_access' | 'data_breach' | 'policy_violation' | 'suspicious_activity' | 'other' | undefined,
      severity: severity as 'low' | 'medium' | 'high' | 'critical' | undefined,
      status: status as 'open' | 'investigating' | 'resolved' | 'false_positive' | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : undefined,
    });

    res.json({ events, total, page: page ? parseInt(page as string, 10) : 1, limit: limit ? parseInt(limit as string, 10) : 100 });
  } catch (error) {
    logger.error('Error getting security events', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/events/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const event = await securityEventService.getEvent(req.params.id);
    res.json(event);
  } catch (error) {
    logger.error('Error getting security event', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.patch('/events/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { status, assignedTo, resolutionNotes, reportedToAuthorities } = req.body;
    const event = await securityEventService.updateEventStatus(req.params.id, status, {
      assignedTo: assignedTo || req.user.userId,
      resolutionNotes,
      reportedToAuthorities,
    });

    res.json(event);
  } catch (error) {
    logger.error('Error updating security event status', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

// Incident Routes
router.post('/incidents', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { severity, incidentType, title, description, detectedBy, affectedServices, affectedTenants, customerImpact, metadata } = req.body;
    const incident = await incidentService.createIncident(severity, incidentType, title, {
      description,
      detectedBy: detectedBy || req.user.userId,
      affectedServices,
      affectedTenants,
      customerImpact,
      metadata,
    });

    res.status(201).json(incident);
  } catch (error) {
    logger.error('Error creating incident', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/incidents', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { severity, incidentType, status, page, limit } = req.query;
    const { incidents, total } = await incidentService.getIncidents({
      severity: severity as 'sev1' | 'sev2' | 'sev3' | 'sev4' | undefined,
      incidentType: incidentType as 'security' | 'availability' | 'data_loss' | 'performance' | 'other' | undefined,
      status: status as 'open' | 'investigating' | 'mitigated' | 'resolved' | 'postmortem' | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : undefined,
    });

    res.json({ incidents, total, page: page ? parseInt(page as string, 10) : 1, limit: limit ? parseInt(limit as string, 10) : 100 });
  } catch (error) {
    logger.error('Error getting incidents', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/incidents/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const incident = await incidentService.getIncident(req.params.id);
    res.json(incident);
  } catch (error) {
    logger.error('Error getting incident', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.patch('/incidents/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== UserRole.SUPER_ADMIN && req.user.role !== UserRole.ACCOUNTANT)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    const { status, assignedTo, onCallRotation, rootCause, resolutionSteps, postmortemDocumentUrl, lessonsLearned, actionItems } = req.body;
    const incident = await incidentService.updateIncidentStatus(req.params.id, status, {
      assignedTo: assignedTo || req.user.userId,
      onCallRotation,
      rootCause,
      resolutionSteps,
      postmortemDocumentUrl,
      lessonsLearned,
      actionItems,
    });

    res.json(incident);
  } catch (error) {
    logger.error('Error updating incident status', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

// Secret Rotation Routes
router.post('/secret-rotations', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can log secret rotations');
    }

    const { secretName, secretType, rotationMethod, status, rotatedBy, oldSecretHash, newSecretHash, rotationPolicy, nextRotationDue, errorMessage, metadata } = req.body;
    const log = await secretRotationService.logRotation(secretName, secretType, rotationMethod, status, {
      rotatedBy: rotatedBy || req.user.userId,
      oldSecretHash,
      newSecretHash,
      rotationPolicy,
      nextRotationDue,
      errorMessage,
      metadata,
    });

    res.status(201).json(log);
  } catch (error) {
    logger.error('Error logging secret rotation', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/secret-rotations', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can view secret rotations');
    }

    const { secretName, secretType, status, page, limit } = req.query;
    const { logs, total } = await secretRotationService.getRotationLogs({
      secretName: secretName as string | undefined,
      secretType: secretType as 'api_key' | 'oauth_token' | 'database_password' | 'encryption_key' | 'other' | undefined,
      status: status as 'success' | 'failed' | 'partial' | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : undefined,
    });

    res.json({ logs, total, page: page ? parseInt(page as string, 10) : 1, limit: limit ? parseInt(limit as string, 10) : 100 });
  } catch (error) {
    logger.error('Error getting secret rotations', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/secret-rotations/due', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can view due rotations');
    }

    const dueRotations = await secretRotationService.getDueRotations();
    res.json(dueRotations);
  } catch (error) {
    logger.error('Error getting due rotations', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

export { router as securityRouter };
