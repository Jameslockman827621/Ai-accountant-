import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { modelRegistryService } from '../services/modelRegistry';
import { modelDriftService } from '../services/modelDrift';
import { UserRole } from '@ai-accountant/shared-types';
import { AuthorizationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('modelops-service');

// Model Registry Routes
router.post('/models', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can register models');
    }

    const { modelName, modelType, version, trainingDataHash, trainingDataLineage, trainingConfig, trainingMetrics, evaluationMetrics, goldenDatasetScores, fairnessMetrics, ownerTeam, ownerEmail, modelArtifactPath, explainabilityArtifacts } = req.body;
    const model = await modelRegistryService.registerModel(modelName, modelType, version, {
      trainingDataHash,
      trainingDataLineage,
      trainingConfig,
      trainingMetrics,
      evaluationMetrics,
      goldenDatasetScores,
      fairnessMetrics,
      ownerTeam,
      ownerEmail,
      modelArtifactPath,
      explainabilityArtifacts,
    });

    res.status(201).json(model);
  } catch (error) {
    logger.error('Error registering model', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/models', async (req: AuthRequest, res: Response) => {
  try {
    const { modelName, modelType, status, page, limit } = req.query;
    const { models, total } = await modelRegistryService.listModels({
      modelName: modelName as string | undefined,
      modelType: modelType as 'classification' | 'extraction' | 'prediction' | 'other' | undefined,
      status: status as 'draft' | 'training' | 'evaluating' | 'approved' | 'deployed' | 'deprecated' | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : undefined,
    });

    res.json({ models, total, page: page ? parseInt(page as string, 10) : 1, limit: limit ? parseInt(limit as string, 10) : 100 });
  } catch (error) {
    logger.error('Error listing models', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/models/:id', async (req: AuthRequest, res: Response) => {
  try {
    const model = await modelRegistryService.getModel(req.params.id);
    res.json(model);
  } catch (error) {
    logger.error('Error getting model', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.patch('/models/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can update model status');
    }

    const { status, deployedBy, rolloutPercentage, evaluationMetrics, goldenDatasetScores, fairnessMetrics } = req.body;
    const model = await modelRegistryService.updateModelStatus(req.params.id, status, {
      deployedBy: deployedBy || req.user.userId,
      rolloutPercentage,
      evaluationMetrics,
      goldenDatasetScores,
      fairnessMetrics,
    });

    res.json(model);
  } catch (error) {
    logger.error('Error updating model status', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

// Model Drift Routes
router.post('/drift-detections', async (req: AuthRequest, res: Response) => {
  try {
    const { modelId, driftType, severity, baselineDistribution, currentDistribution, driftScore, statisticalTest, pValue, metadata } = req.body;
    const detection = await modelDriftService.detectDrift(modelId, driftType, severity, {
      baselineDistribution,
      currentDistribution,
      driftScore,
      statisticalTest,
      pValue,
      metadata,
    });

    res.status(201).json(detection);
  } catch (error) {
    logger.error('Error detecting drift', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/drift-detections', async (req: AuthRequest, res: Response) => {
  try {
    const { modelId, driftType, severity, status, page, limit } = req.query;
    const { detections, total } = await modelDriftService.getDriftDetections({
      modelId: modelId as string | undefined,
      driftType: driftType as 'data_drift' | 'concept_drift' | 'prediction_drift' | undefined,
      severity: severity as 'low' | 'medium' | 'high' | 'critical' | undefined,
      status: status as 'open' | 'investigating' | 'resolved' | 'false_positive' | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : undefined,
    });

    res.json({ detections, total, page: page ? parseInt(page as string, 10) : 1, limit: limit ? parseInt(limit as string, 10) : 100 });
  } catch (error) {
    logger.error('Error getting drift detections', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/drift-detections/:id', async (req: AuthRequest, res: Response) => {
  try {
    const detection = await modelDriftService.getDriftDetection(req.params.id);
    res.json(detection);
  } catch (error) {
    logger.error('Error getting drift detection', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.patch('/drift-detections/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    const { status, resolvedBy, resolutionNotes } = req.body;
    const detection = await modelDriftService.updateDriftStatus(req.params.id, status, {
      resolvedBy: resolvedBy || req.user?.userId,
      resolutionNotes,
    });

    res.json(detection);
  } catch (error) {
    logger.error('Error updating drift status', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

export { router as modelopsRouter };
