import { runValidationSuite } from '../validationSummary';
import { db } from '@ai-accountant/database';
import { validateTaxCalculation } from '../taxValidator';
import { checkDataAccuracy } from '../dataAccuracy';
import { detectAnomalies } from '../anomalyDetector';
import { checkConfidenceThresholds } from '../confidenceThreshold';
import { TenantId } from '@ai-accountant/shared-types';

jest.mock('@ai-accountant/database', () => ({
  db: {
    query: jest.fn(),
  },
}));

jest.mock('../taxValidator', () => ({
  validateTaxCalculation: jest.fn(),
}));

jest.mock('../dataAccuracy', () => ({
  checkDataAccuracy: jest.fn(),
}));

jest.mock('../anomalyDetector', () => ({
  detectAnomalies: jest.fn(),
}));

jest.mock('../confidenceThreshold', () => ({
  checkConfidenceThresholds: jest.fn(),
  MIN_CONFIDENCE_THRESHOLD: 0.85,
  CRITICAL_CONFIDENCE_THRESHOLD: 0.7,
}));

const mockDbQuery = db.query as jest.Mock;
const mockValidateTax = validateTaxCalculation as jest.Mock;
const mockCheckAccuracy = checkDataAccuracy as jest.Mock;
const mockDetectAnomalies = detectAnomalies as jest.Mock;
const mockConfidenceChecks = checkConfidenceThresholds as jest.Mock;

const baseOptions = {
  tenantId: 'tenant-1' as TenantId,
  entityType: 'filing',
  entityId: 'filing-1',
  filingType: 'vat',
  filingData: {
    vatDueSales: 1000,
    vatDueAcquisitions: 0,
    totalVatDue: 1000,
    vatReclaimedCurrPeriod: 200,
    netVatDue: 800,
  },
  periodStart: new Date('2025-01-01'),
  periodEnd: new Date('2025-02-01'),
  includeConfidenceChecks: true,
};

describe('runValidationSuite', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockDbQuery.mockResolvedValue({ rows: [{ id: 'record-id' }] });
    mockValidateTax.mockResolvedValue({
      isValid: true,
      errors: [],
      warnings: [],
      confidence: 0.97,
    });
    mockCheckAccuracy.mockResolvedValue([
      { check: 'Double-entry balance', passed: true, message: 'Balanced' },
      { check: 'Document posting rate', passed: true, message: '95% posted' },
    ]);
    mockDetectAnomalies.mockResolvedValue([]);
    mockConfidenceChecks.mockResolvedValue([
      { documentId: 'doc-1', confidenceScore: 0.9, requiresReview: false },
    ]);
  });

  it('returns a passing summary when all checks succeed', async () => {
    const summary = await runValidationSuite(baseOptions);

    expect(summary.status).toBe('pass');
    expect(summary.components.tax?.isValid).toBe(true);
    expect(summary.components.accuracy?.checks).toHaveLength(2);
    expect(summary.components.anomalies?.items).toHaveLength(0);
    expect(summary.components.confidence?.checks).toHaveLength(1);
    expect(summary.errors).toHaveLength(0);
    expect(summary.warnings).toHaveLength(0);
      expect(mockDbQuery).toHaveBeenCalled();
  });

  it('escalates to fail when high severity anomalies are detected', async () => {
    mockDetectAnomalies.mockResolvedValue([
      {
        type: 'amount',
        severity: 'high',
        description: 'Large transaction spike',
      },
    ]);

    const summary = await runValidationSuite(baseOptions);

    expect(summary.status).toBe('fail');
    expect(summary.errors).toContain('High severity anomalies detected');
  });
});
