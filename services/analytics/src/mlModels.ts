import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('analytics-service');

// ML Models for Predictive Analytics
export class MLModels {
  // Revenue prediction using time series analysis
  async predictRevenueML(
    tenantId: TenantId,
    months: number = 6
  ): Promise<{
    predictions: Array<{ month: Date; predicted: number; confidence: number }>;
    model: string;
  }> {
    logger.info('Running ML revenue prediction', { tenantId, months });

    // Get historical data
    const historical = await db.query<{
      month: Date;
      revenue: string | number;
    }>(
      `SELECT 
         DATE_TRUNC('month', transaction_date) as month,
         SUM(amount) as revenue
       FROM ledger_entries
       WHERE tenant_id = $1
         AND entry_type = 'credit'
         AND account_code LIKE '4%'
         AND transaction_date >= NOW() - INTERVAL '24 months'
       GROUP BY DATE_TRUNC('month', transaction_date)
       ORDER BY month`,
      [tenantId]
    );

    // Simple linear regression (in production, use TensorFlow.js or similar)
    const revenues = historical.rows.map(r =>
      typeof r.revenue === 'number' ? r.revenue : parseFloat(String(r.revenue || '0'))
    );

    if (revenues.length < 3) {
      throw new Error('Insufficient historical data for ML prediction');
    }

    // Calculate trend
    const n = revenues.length;
    const sumX = (n * (n + 1)) / 2;
    const sumY = revenues.reduce((a, b) => a + b, 0);
    const sumXY = revenues.reduce((sum, val, idx) => sum + (idx + 1) * val, 0);
    const sumX2 = (n * (n + 1) * (2 * n + 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Generate predictions
    const predictions = [];
    const startDate = new Date();
    for (let i = 1; i <= months; i++) {
      const month = new Date(startDate);
      month.setMonth(month.getMonth() + i);
      const predicted = intercept + slope * (n + i);
      const confidence = Math.max(0.5, 1 - (i * 0.1)); // Decreasing confidence over time
      predictions.push({
        month,
        predicted: Math.round(predicted * 100) / 100,
        confidence: Math.round(confidence * 100) / 100,
      });
    }

    return {
      predictions,
      model: 'linear_regression_v1',
    };
  }

  // Expense categorization using clustering
  async categorizeExpensesML(tenantId: TenantId): Promise<Array<{
    category: string;
    amount: number;
    confidence: number;
  }>> {
    logger.info('Running ML expense categorization', { tenantId });

    const expenses = await db.query<{
      description: string;
      amount: number;
      account_code: string;
    }>(
      `SELECT description, amount, account_code
       FROM ledger_entries
       WHERE tenant_id = $1
         AND entry_type = 'debit'
         AND transaction_date >= NOW() - INTERVAL '12 months'
       LIMIT 1000`,
      [tenantId]
    );

    // Simple keyword-based categorization (in production, use NLP/ML)
    const categories: Record<string, number> = {};
    
    for (const expense of expenses.rows) {
      const desc = expense.description.toLowerCase();
      let category = 'Other';
      
      if (desc.includes('office') || desc.includes('supplies')) {
        category = 'Office Supplies';
      } else if (desc.includes('travel') || desc.includes('hotel')) {
        category = 'Travel';
      } else if (desc.includes('software') || desc.includes('saas')) {
        category = 'Software';
      } else if (desc.includes('marketing') || desc.includes('advertising')) {
        category = 'Marketing';
      }

      categories[category] = (categories[category] || 0) + expense.amount;
    }

    return Object.entries(categories).map(([category, amount]) => ({
      category,
      amount: Math.round(amount * 100) / 100,
      confidence: 0.8, // In production, calculate from ML model
    }));
  }
}

export const mlModels = new MLModels();
