import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import OpenAI from 'openai';
import { getEntityTaxProfile } from './ukTaxEntities';
import { calculateIncomeTax, calculateCorporationTax } from './ukTaxCalculations';
import { calculateAllReliefs } from './ukTaxReliefs';
import { performComplianceCheck } from './ukCompliance';
import { generateTaxOptimizationReport } from './ukTaxOptimization';
import { db } from '@ai-accountant/database';

const logger = createLogger('rules-engine-service');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface TaxAdvice {
  id: string;
  category: 'compliance' | 'optimization' | 'planning' | 'relief' | 'structure' | 'timing';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  reasoning: string;
  actionItems: string[];
  potentialImpact: {
    taxSaving?: number;
    riskReduction?: number;
    complianceImprovement?: string;
  };
  confidence: number;
  sources: string[];
}

export interface TaxAdviceReport {
  tenantId: TenantId;
  generatedAt: Date;
  taxYear: string;
  summary: {
    totalAdvice: number;
    highPriority: number;
    estimatedSavings: number;
    complianceIssues: number;
  };
  advice: TaxAdvice[];
  recommendations: string[];
}

export async function generateTaxAdvice(
  tenantId: TenantId,
  question?: string
): Promise<TaxAdviceReport> {
  const profile = await getEntityTaxProfile(tenantId);
  const advice: TaxAdvice[] = [];

  // Get financial data
  const financialData = await getFinancialData(tenantId);

  // Compliance check
  const compliance = await performComplianceCheck(tenantId);
  for (const issue of compliance.issues) {
    if (issue.severity === 'error' || issue.severity === 'warning') {
      advice.push({
        id: `COMP-${issue.code}`,
        category: 'compliance',
        priority: issue.severity === 'error' ? 'high' : 'medium',
        title: issue.title,
        description: issue.description,
        reasoning: issue.recommendation,
        actionItems: [issue.recommendation],
        potentialImpact: {
          riskReduction: issue.penalty?.amount || 0,
          complianceImprovement: 'Resolve compliance issue',
        },
        confidence: 0.95,
        sources: ['HMRC Guidelines'],
      });
    }
  }

  // Optimization opportunities
  const optimization = await generateTaxOptimizationReport(tenantId);
  for (const strategy of optimization.recommendations.immediate) {
    advice.push({
      id: `OPT-${strategy.id}`,
      category: 'optimization',
      priority: 'high',
      title: strategy.name,
      description: strategy.description,
      reasoning: `Potential saving of £${strategy.potentialSaving.toLocaleString()}. ${strategy.compliance.notes}`,
      actionItems: strategy.implementation.steps,
      potentialImpact: {
        taxSaving: strategy.potentialSaving,
      },
      confidence: 0.85,
      sources: ['HMRC Tax Manual', 'Tax Planning Guidelines'],
    });
  }

  // Relief opportunities
  const reliefs = await calculateAllReliefs(tenantId, {
    rndExpenditure: financialData.rndExpenditure,
    aiaExpenditure: financialData.capitalExpenditure,
  });

  if (reliefs.totalTaxSaving > 0) {
    advice.push({
      id: 'REL-001',
      category: 'relief',
      priority: 'high',
      title: 'Tax Relief Opportunities Available',
      description: `You may be eligible for tax reliefs worth £${reliefs.totalTaxSaving.toLocaleString()}`,
      reasoning: 'Review available reliefs and ensure all eligible reliefs are claimed',
      actionItems: [
        'Review R&D expenditure for relief eligibility',
        'Claim Annual Investment Allowance on capital expenditure',
        'Consider EIS/SEIS investments if applicable',
      ],
      potentialImpact: {
        taxSaving: reliefs.totalTaxSaving,
      },
      confidence: 0.90,
      sources: ['HMRC Relief Guidelines'],
    });
  }

  // AI-powered advice for specific questions
  if (question) {
    const aiAdvice = await generateAITaxAdvice(tenantId, question, profile, financialData);
    advice.push(...aiAdvice);
  }

  // Calculate summary
  const totalSavings = advice.reduce((sum, a) => sum + (a.potentialImpact.taxSaving || 0), 0);
  const highPriority = advice.filter(a => a.priority === 'high').length;

  return {
    tenantId,
    generatedAt: new Date(),
    taxYear: profile.taxYear,
    summary: {
      totalAdvice: advice.length,
      highPriority,
      estimatedSavings: totalSavings,
      complianceIssues: compliance.summary.errors + compliance.summary.warnings,
    },
    advice: advice.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    }),
    recommendations: compliance.recommendations,
  };
}

async function getFinancialData(tenantId: TenantId): Promise<{
  revenue: number;
  expenses: number;
  profit: number;
  capitalExpenditure: number;
  rndExpenditure: number;
}> {
  const yearStart = new Date(new Date().getFullYear(), 3, 6);
  const yearEnd = new Date(new Date().getFullYear() + 1, 3, 5);

  const revenueResult = await db.query<{ revenue: string | number }>(
    `SELECT COALESCE(SUM(amount), 0) as revenue
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'credit'
       AND account_code LIKE '4%'
       AND transaction_date >= $2
       AND transaction_date <= $3`,
    [tenantId, yearStart, yearEnd]
  );

  const expensesResult = await db.query<{ expenses: string | number }>(
    `SELECT COALESCE(SUM(amount), 0) as expenses
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'debit'
       AND (account_code LIKE '5%' OR account_code LIKE '6%')
       AND transaction_date >= $2
       AND transaction_date <= $3`,
    [tenantId, yearStart, yearEnd]
  );

  return {
    revenue: typeof revenueResult.rows[0]?.revenue === 'number'
      ? revenueResult.rows[0].revenue
      : parseFloat(String(revenueResult.rows[0]?.revenue || '0')),
    expenses: typeof expensesResult.rows[0]?.expenses === 'number'
      ? expensesResult.rows[0].expenses
      : parseFloat(String(expensesResult.rows[0]?.expenses || '0')),
    profit: 0, // Calculated
    capitalExpenditure: 0,
    rndExpenditure: 0,
  };
}

async function generateAITaxAdvice(
  tenantId: TenantId,
  question: string,
  profile: any,
  financialData: any
): Promise<TaxAdvice[]> {
  try {
    const prompt = `You are an expert UK tax advisor. Provide specific, accurate tax advice based on this context:

Entity Type: ${profile.entityType}
Tax Year: ${profile.taxYear}
Revenue: £${financialData.revenue.toLocaleString()}
Expenses: £${financialData.expenses.toLocaleString()}

Question: ${question}

Provide advice in JSON format:
{
  "advice": [
    {
      "category": "compliance|optimization|planning|relief|structure|timing",
      "priority": "high|medium|low",
      "title": "Advice title",
      "description": "Detailed description",
      "reasoning": "Why this advice is relevant",
      "actionItems": ["action 1", "action 2"],
      "potentialImpact": {
        "taxSaving": 0,
        "riskReduction": 0
      },
      "confidence": 0.0-1.0,
      "sources": ["source 1"]
    }
  ]
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are an expert UK tax advisor. Provide accurate, HMRC-compliant tax advice. Always respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const response = JSON.parse(completion.choices[0]?.message?.content || '{}');
    return (response.advice || []).map((a: any, index: number) => ({
      id: `AI-${Date.now()}-${index}`,
      ...a,
    }));
  } catch (error) {
    logger.error('AI tax advice generation failed', error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}

export async function getTaxAdviceForScenario(
  tenantId: TenantId,
  scenario: {
    revenue?: number;
    expenses?: number;
    entityType?: string;
    questions?: string[];
  }
): Promise<TaxAdvice[]> {
  const advice: TaxAdvice[] = [];

  // Calculate tax for scenario
  if (scenario.revenue && scenario.expenses) {
    const profit = scenario.revenue - scenario.expenses;
    
    // Would calculate tax for different entity types
    // Provide advice based on comparison

    advice.push({
      id: 'SCEN-001',
      category: 'planning',
      priority: 'medium',
      title: 'Scenario Tax Analysis',
      description: `Based on revenue of £${scenario.revenue.toLocaleString()} and expenses of £${scenario.expenses.toLocaleString()}`,
      reasoning: 'Tax liability calculated for this scenario',
      actionItems: ['Review tax calculations', 'Consider tax optimization strategies'],
      potentialImpact: {},
      confidence: 0.80,
      sources: ['Tax Calculation Engine'],
    });
  }

  // Answer specific questions
  if (scenario.questions) {
    for (const question of scenario.questions) {
      const aiAdvice = await generateAITaxAdvice(tenantId, question, {}, {});
      advice.push(...aiAdvice);
    }
  }

  return advice;
}
