import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { goldenDatasetService } from '../services/goldenDataset';
import { regressionTestService } from '../services/regressionTests';
import { UserRole } from '@ai-accountant/shared-types';
import { AuthorizationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('quality-service');

// Golden Dataset Routes
router.post('/golden-datasets', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can create golden datasets');
    }

    const { name, samples, jurisdiction, filingType, documentType, version, description, metadata } = req.body;
    const dataset = await goldenDatasetService.createDataset(name, samples, {
      jurisdiction,
      filingType,
      documentType,
      version,
      description,
      metadata,
      createdBy: req.user.userId,
    });

    res.status(201).json(dataset);
  } catch (error) {
    logger.error('Error creating golden dataset', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/golden-datasets', async (req: AuthRequest, res: Response) => {
  try {
    const { jurisdiction, filingType, documentType, isActive } = req.query;
    const datasets = await goldenDatasetService.listDatasets({
      jurisdiction: jurisdiction as string | undefined,
      filingType: filingType as string | undefined,
      documentType: documentType as string | undefined,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });

    res.json(datasets);
  } catch (error) {
    logger.error('Error listing golden datasets', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/golden-datasets/:id', async (req: AuthRequest, res: Response) => {
  try {
    const dataset = await goldenDatasetService.getDataset(req.params.id);
    res.json(dataset);
  } catch (error) {
    logger.error('Error getting golden dataset', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.post('/golden-datasets/:id/versions', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      throw new AuthorizationError('Only super admins can create dataset versions');
    }

    const { version, samples, description, metadata } = req.body;
    const newVersion = await goldenDatasetService.createVersion(req.params.id, version, samples, {
      description,
      metadata,
      createdBy: req.user.userId,
    });

    res.status(201).json(newVersion);
  } catch (error) {
    logger.error('Error creating dataset version', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

// Regression Test Routes
router.post('/regression-tests', async (req: AuthRequest, res: Response) => {
  try {
    const { testSuite, testName, status, goldenDatasetId, executionTimeMs, expectedOutput, actualOutput, diff, errorMessage, serviceVersion, modelVersion, environment, metadata } = req.body;
    const result = await regressionTestService.recordTestResult(testSuite, testName, status, {
      goldenDatasetId,
      executionTimeMs,
      runBy: req.user?.userId,
      expectedOutput,
      actualOutput,
      diff,
      errorMessage,
      serviceVersion,
      modelVersion,
      environment,
      metadata,
    });

    res.status(201).json(result);
  } catch (error) {
    logger.error('Error recording test result', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/regression-tests', async (req: AuthRequest, res: Response) => {
  try {
    const { testSuite, status, environment, page, limit } = req.query;
    const { results, total } = await regressionTestService.getTestResults({
      testSuite: testSuite as string | undefined,
      status: status as 'pass' | 'fail' | 'skipped' | 'error' | undefined,
      environment: environment as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : undefined,
    });

    res.json({ results, total, page: page ? parseInt(page as string, 10) : 1, limit: limit ? parseInt(limit as string, 10) : 100 });
  } catch (error) {
    logger.error('Error getting test results', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/regression-tests/:id', async (req: AuthRequest, res: Response) => {
  try {
    const result = await regressionTestService.getTestResult(req.params.id);
    res.json(result);
  } catch (error) {
    logger.error('Error getting test result', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

router.get('/regression-tests/suite/:testSuite/summary', async (req: AuthRequest, res: Response) => {
  try {
    const { environment } = req.query;
    const summary = await regressionTestService.getTestSuiteSummary(req.params.testSuite, environment as string | undefined);
    res.json(summary);
  } catch (error) {
    logger.error('Error getting test suite summary', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

export { router as qualityRouter };
