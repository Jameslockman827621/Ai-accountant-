import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  calculateIncomeTax,
  calculateCorporationTax,
  calculateNationalInsurance,
  calculateCapitalGainsTax,
} from '../services/ukTaxCalculations';
import {
  calculateVAT,
  determineVATRate,
} from '../services/ukVATCalculations';
import {
  calculateAllReliefs,
} from '../services/ukTaxReliefs';
import {
  calculateFilingDeadlines,
} from '../services/ukFilingDeadlines';
import {
  getEntityTaxProfile,
  setEntityType,
  getAllEntityTypes,
  getEntityTypeDescription,
  UKEntityType,
} from '../services/ukTaxEntities';
import {
  calculatePAYE,
  generatePAYEReturn,
} from '../services/ukPAYE';
import {
  performComplianceCheck,
} from '../services/ukCompliance';
import {
  generateTaxOptimizationReport,
} from '../services/ukTaxOptimization';
import {
  calculatePensionTaxRelief,
  calculatePensionAllowance,
  calculateOptimalPensionContribution,
} from '../services/ukPensionCalculations';
import {
  calculateInheritanceTax,
  generateInheritanceTaxPlanning,
} from '../services/ukInheritanceTax';
import {
  calculateStampDuty,
  calculateStampDutySavings,
} from '../services/ukStampDuty';
import {
  generateCISReturn,
  verifyCISSubcontractor,
  checkCISRegistration,
} from '../services/ukCIS';
import {
  generateTaxAdvice,
  getTaxAdviceForScenario,
} from '../services/ukTaxAdviceEngine';
import {
  getIndustryRules,
  determineIndustryVATRate,
  getIndustrySpecificReliefs,
} from '../services/ukIndustryRules';
import {
  getHistoricalTaxRates,
  getAllAvailableTaxYears,
} from '../services/ukHistoricalTaxRates';
import {
  getHMRCVATReturns,
  submitHMRCVATReturn,
  validateVATNumber,
} from '../services/ukHMRCIntegration';
import {
  generateMultiYearTaxPlan,
} from '../services/ukMultiYearPlanning';

const router = Router();
const logger = createLogger('rules-engine-service');

// Get entity tax profile
router.get('/entity-profile', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const profile = await getEntityTaxProfile(req.user.tenantId);
    res.json({ profile });
  } catch (error) {
    logger.error('Get entity profile failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get entity profile' });
  }
});

// Set entity type
router.post('/entity-type', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { entityType } = req.body;
    if (!entityType || !getAllEntityTypes().includes(entityType)) {
      res.status(400).json({ error: 'Invalid entity type' });
      return;
    }

    await setEntityType(req.user.tenantId, entityType as UKEntityType);
    res.json({ message: 'Entity type updated', entityType });
  } catch (error) {
    logger.error('Set entity type failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to set entity type' });
  }
});

// Get all entity types
router.get('/entity-types', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const types = getAllEntityTypes().map(type => ({
      type,
      description: getEntityTypeDescription(type),
    }));

    res.json({ entityTypes: types });
  } catch (error) {
    logger.error('Get entity types failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get entity types' });
  }
});

// Calculate Income Tax
router.post('/calculate/income-tax', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { totalIncome, dividendIncome, savingsIncome, otherIncome } = req.body;

    const calculation = await calculateIncomeTax(
      req.user.tenantId,
      totalIncome || 0,
      dividendIncome || 0,
      savingsIncome || 0,
      otherIncome || 0
    );

    res.json({ calculation });
  } catch (error) {
    logger.error('Calculate income tax failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate income tax' });
  }
});

// Calculate Corporation Tax
router.post('/calculate/corporation-tax', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { profitBeforeTax, adjustments } = req.body;

    const calculation = await calculateCorporationTax(
      req.user.tenantId,
      profitBeforeTax || 0,
      adjustments || 0
    );

    res.json({ calculation });
  } catch (error) {
    logger.error('Calculate corporation tax failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate corporation tax' });
  }
});

// Calculate National Insurance
router.post('/calculate/national-insurance', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { profits, salary, weeks } = req.body;

    const calculation = await calculateNationalInsurance(
      req.user.tenantId,
      profits || 0,
      salary || 0,
      weeks || 52
    );

    res.json({ calculation });
  } catch (error) {
    logger.error('Calculate national insurance failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate national insurance' });
  }
});

// Calculate VAT
router.post('/calculate/vat', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { transactions, periodStart, periodEnd, useFlatRateScheme, flatRateCategory } = req.body;

    const calculation = await calculateVAT(
      req.user.tenantId,
      transactions || [],
      new Date(periodStart),
      new Date(periodEnd),
      useFlatRateScheme || false,
      flatRateCategory || 'general'
    );

    res.json({ calculation });
  } catch (error) {
    logger.error('Calculate VAT failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate VAT' });
  }
});

// Calculate Capital Gains Tax
router.post('/calculate/capital-gains-tax', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { gains, losses, isEntrepreneursRelief, entrepreneursReliefUsed } = req.body;

    const calculation = await calculateCapitalGainsTax(
      req.user.tenantId,
      gains || 0,
      losses || 0,
      isEntrepreneursRelief || false,
      entrepreneursReliefUsed || 0
    );

    res.json({ calculation });
  } catch (error) {
    logger.error('Calculate capital gains tax failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate capital gains tax' });
  }
});

// Calculate Tax Reliefs
router.post('/calculate/reliefs', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const reliefs = await calculateAllReliefs(req.user.tenantId, req.body);
    res.json({ reliefs });
  } catch (error) {
    logger.error('Calculate reliefs failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate reliefs' });
  }
});

// Get Filing Deadlines
router.get('/filing-deadlines', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { asOfDate } = req.query;
    const deadlines = await calculateFilingDeadlines(
      req.user.tenantId,
      asOfDate ? new Date(asOfDate as string) : new Date()
    );

    res.json({ deadlines });
  } catch (error) {
    logger.error('Get filing deadlines failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get filing deadlines' });
  }
});

// Determine VAT Rate
router.post('/vat-rate', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { category, description } = req.body;
    const profile = await getEntityTaxProfile(req.user.tenantId);
    const isCharity = profile.entityType === 'charity';

    const vatRate = determineVATRate(category || '', description || '', isCharity);

    res.json({ vatRate, category, description });
  } catch (error) {
    logger.error('Determine VAT rate failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to determine VAT rate' });
  }
});

// PAYE Calculations
router.post('/calculate/paye', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employee, payment, cumulativeData } = req.body;

    const calculation = await calculatePAYE(
      req.user.tenantId,
      employee,
      payment,
      cumulativeData || {}
    );

    res.json({ calculation });
  } catch (error) {
    logger.error('Calculate PAYE failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate PAYE' });
  }
});

router.post('/paye/return', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employees, payments, period } = req.body;

    const returnData = await generatePAYEReturn(
      req.user.tenantId,
      employees || [],
      payments || [],
      period
    );

    res.json({ return: returnData });
  } catch (error) {
    logger.error('Generate PAYE return failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to generate PAYE return' });
  }
});

// Compliance Checking
router.get('/compliance', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { asOfDate } = req.query;
    const report = await performComplianceCheck(
      req.user.tenantId,
      asOfDate ? new Date(asOfDate as string) : new Date()
    );

    res.json({ report });
  } catch (error) {
    logger.error('Compliance check failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to perform compliance check' });
  }
});

// Tax Optimization
router.get('/optimization', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taxYear } = req.query;
    const report = await generateTaxOptimizationReport(
      req.user.tenantId,
      taxYear as string || '2024-25'
    );

    res.json({ report });
  } catch (error) {
    logger.error('Tax optimization failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to generate tax optimization report' });
  }
});

// Pension Calculations
router.post('/calculate/pension', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { contribution, isEmployerContribution, adjustedIncome } = req.body;

    const relief = await calculatePensionTaxRelief(
      req.user.tenantId,
      contribution || 0,
      isEmployerContribution || false,
      adjustedIncome || 0
    );

    res.json({ relief });
  } catch (error) {
    logger.error('Calculate pension relief failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate pension relief' });
  }
});

router.post('/pension/allowance', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taxYear, contributions, previousContributions, lifetimeContributions, adjustedIncome } = req.body;

    const calculation = await calculatePensionAllowance(
      req.user.tenantId,
      taxYear || '2024-25',
      contributions,
      previousContributions || 0,
      lifetimeContributions || 0,
      adjustedIncome || 0
    );

    res.json({ calculation });
  } catch (error) {
    logger.error('Calculate pension allowance failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate pension allowance' });
  }
});

router.get('/pension/optimal', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taxYear, income, existingContributions } = req.query;

    const recommendation = await calculateOptimalPensionContribution(
      req.user.tenantId,
      taxYear as string || '2024-25',
      parseFloat(income as string) || 0,
      parseFloat(existingContributions as string) || 0
    );

    res.json({ recommendation });
  } catch (error) {
    logger.error('Calculate optimal pension failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate optimal pension' });
  }
});

// Inheritance Tax
router.post('/calculate/inheritance-tax', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { estate, isMarried, spouseNilRateBandAvailable, charityDonation } = req.body;

    const calculation = await calculateInheritanceTax(
      estate,
      isMarried || false,
      spouseNilRateBandAvailable || false,
      charityDonation || 0
    );

    res.json({ calculation });
  } catch (error) {
    logger.error('Calculate inheritance tax failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate inheritance tax' });
  }
});

router.post('/inheritance-tax/planning', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { estate, currentAge, lifeExpectancy } = req.body;

    const strategies = await generateInheritanceTaxPlanning(
      estate,
      currentAge || 50,
      lifeExpectancy || 85
    );

    res.json({ strategies });
  } catch (error) {
    logger.error('Generate IHT planning failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to generate IHT planning' });
  }
});

// Stamp Duty
router.post('/calculate/stamp-duty', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { transaction } = req.body;

    const calculation = calculateStampDuty(transaction);

    res.json({ calculation });
  } catch (error) {
    logger.error('Calculate stamp duty failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate stamp duty' });
  }
});

router.post('/stamp-duty/savings', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { currentTransaction, alternativeScenarios } = req.body;

    const savings = calculateStampDutySavings(currentTransaction, alternativeScenarios || []);

    res.json({ savings });
  } catch (error) {
    logger.error('Calculate stamp duty savings failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate stamp duty savings' });
  }
});

// CIS
router.post('/cis/return', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { period, payments } = req.body;

    const returnData = await generateCISReturn(
      req.user.tenantId,
      period,
      payments || []
    );

    res.json({ return: returnData });
  } catch (error) {
    logger.error('Generate CIS return failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to generate CIS return' });
  }
});

router.post('/cis/verify', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { utr, nino } = req.body;

    const verification = await verifyCISSubcontractor(utr, nino);

    res.json({ verification });
  } catch (error) {
    logger.error('CIS verification failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to verify CIS subcontractor' });
  }
});

router.get('/cis/registration', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const status = await checkCISRegistration(req.user.tenantId);

    res.json({ status });
  } catch (error) {
    logger.error('CIS registration check failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to check CIS registration' });
  }
});

// Tax Advice
router.get('/advice', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { question } = req.query;

    const report = await generateTaxAdvice(
      req.user.tenantId,
      question as string | undefined
    );

    res.json({ report });
  } catch (error) {
    logger.error('Generate tax advice failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to generate tax advice' });
  }
});

router.post('/advice/scenario', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { scenario } = req.body;

    const advice = await getTaxAdviceForScenario(req.user.tenantId, scenario);

    res.json({ advice });
  } catch (error) {
    logger.error('Get scenario advice failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get scenario advice' });
  }
});

// Industry Rules
router.get('/industry/:industry/rules', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { industry } = req.params;

    const rules = await getIndustryRules(industry as any);

    res.json({ rules });
  } catch (error) {
    logger.error('Get industry rules failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get industry rules' });
  }
});

router.post('/industry/vat-rate', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { industry, category, description } = req.body;

    const vatRate = await determineIndustryVATRate(industry, category || '', description || '');

    res.json({ vatRate, industry, category, description });
  } catch (error) {
    logger.error('Determine industry VAT rate failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to determine industry VAT rate' });
  }
});

router.get('/industry/:industry/reliefs', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { industry } = req.params;

    const reliefs = await getIndustrySpecificReliefs(req.user.tenantId, industry as any);

    res.json({ reliefs });
  } catch (error) {
    logger.error('Get industry reliefs failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get industry reliefs' });
  }
});

// Historical Tax Rates
router.get('/historical-rates/:taxYear', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taxYear } = req.params;

    const rates = getHistoricalTaxRates(taxYear);

    if (!rates) {
      res.status(404).json({ error: 'Tax year not found' });
      return;
    }

    res.json({ rates });
  } catch (error) {
    logger.error('Get historical rates failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get historical rates' });
  }
});

router.get('/historical-rates', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const years = getAllAvailableTaxYears();

    res.json({ taxYears: years });
  } catch (error) {
    logger.error('Get tax years failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get tax years' });
  }
});

// HMRC Integration
router.get('/hmrc/vat-returns', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { vatNumber, fromDate, toDate } = req.query;

    if (!vatNumber) {
      res.status(400).json({ error: 'VAT number required' });
      return;
    }

    const returns = await getHMRCVATReturns(
      vatNumber as string,
      fromDate ? new Date(fromDate as string) : undefined,
      toDate ? new Date(toDate as string) : undefined
    );

    res.json({ returns });
  } catch (error) {
    logger.error('Get HMRC VAT returns failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get HMRC VAT returns' });
  }
});

router.post('/hmrc/vat-return/submit', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { vatNumber, returnData } = req.body;

    if (!vatNumber || !returnData) {
      res.status(400).json({ error: 'VAT number and return data required' });
      return;
    }

    const result = await submitHMRCVATReturn(vatNumber, returnData);

    res.json({ result });
  } catch (error) {
    logger.error('Submit HMRC VAT return failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to submit HMRC VAT return' });
  }
});

router.post('/hmrc/validate-vat', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { vatNumber } = req.body;

    if (!vatNumber) {
      res.status(400).json({ error: 'VAT number required' });
      return;
    }

    const validation = await validateVATNumber(vatNumber);

    res.json({ validation });
  } catch (error) {
    logger.error('Validate VAT number failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to validate VAT number' });
  }
});

// Multi-Year Planning
router.get('/planning/multi-year', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { years, growthRate } = req.query;

    const plan = await generateMultiYearTaxPlan(
      req.user.tenantId,
      parseInt(years as string) || 5,
      parseFloat(growthRate as string) || 0.05
    );

    res.json({ plan });
  } catch (error) {
    logger.error('Multi-year planning failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to generate multi-year plan' });
  }
});

export { router as ukTaxRouter };
